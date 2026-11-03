"""The stand-in runtime: replay, pauses, crash recovery, the journal guard and secret inputs."""
import asyncio
import json
import os
import stat

import pytest

from computer_use import TYPING_SECRETS
from progress import progress
from runtime import WORKFLOWS, Engine, workflow

calls: dict[str, int] = {}


def counted(name, result=None):
    def step():
        calls[name] = calls.get(name, 0) + 1
        return result if result is not None else name
    return step


@pytest.fixture(autouse=True)
def fresh():
    calls.clear()
    saved = dict(WORKFLOWS)
    progress.enabled = False
    yield
    WORKFLOWS.clear()
    WORKFLOWS.update(saved)


async def settle(engine: Engine) -> None:
    while any(not task.done() for task in engine.tasks.values()):
        await asyncio.sleep(0.01)
    for task in engine.tasks.values():
        task.result()  # surface errors from the engine itself


def run(coro):
    return asyncio.run(coro)


def new_engine(tmp_path) -> Engine:
    engine = Engine(tmp_path)
    engine.loop = asyncio.get_running_loop()
    return engine


def types(engine, run_id):
    return [e["type"] for e in engine.journals[run_id].events]


def test_steps_run_once_and_replay_after_a_pause(tmp_path):
    @workflow("approve_then_finish")
    async def flow(ctx):
        a = await ctx.step("a", counted("a"))
        answer = await ctx.wait_for_user("Go on?", input_type="approval")
        b = await ctx.step("b", counted("b"))
        return {"a": a, "answer": answer, "b": b}

    async def main():
        engine = new_engine(tmp_path)
        started = engine.start("approve_then_finish", {})
        await settle(engine)
        assert engine.runs[started["id"]]["status"] == "awaiting_user_input"
        assert engine.runs[started["id"]]["pause"]["step_key"] == "wait_for_user_1"
        engine.resume(started["id"], "approved")
        await settle(engine)
        finished = engine.runs[started["id"]]
        assert finished["status"] == "completed"
        assert finished["output"] == {"a": "a", "answer": "approved", "b": "b"}
        assert calls == {"a": 1, "b": 1}  # a replayed from the journal on resume
        assert types(engine, started["id"]).count("approval.requested") == 1
    run(main())


def test_a_restart_runs_only_the_step_that_was_cut_off(tmp_path):
    @workflow("two_steps")
    async def flow(ctx):
        await ctx.step("a", counted("a"))
        await ctx.step("b", counted("b"))
        return "done"

    async def main():
        engine = new_engine(tmp_path)
        run_id = engine.start("two_steps", {})["id"]
        await settle(engine)
        # Rewrite history as if the runner died while b was running: a done, b started, nothing after.
        journal = engine.journals[run_id]
        kept = [e for e in journal.events if e["type"] in ("run.started",) or e["step"] == "a"]
        kept.append({**next(e for e in journal.events if e["type"] == "workflow.step.started" and e["step"] == "b")})
        journal.path.write_text("".join(json.dumps(e) + "\n" for e in kept))
        record = json.loads((tmp_path / "runs" / run_id / "run.json").read_text())
        record.update(status="running", output=None)
        (tmp_path / "runs" / run_id / "run.json").write_text(json.dumps(record))
        calls.clear()

        restarted = new_engine(tmp_path)
        restarted.recover()
        await settle(restarted)
        assert restarted.runs[run_id]["status"] == "completed"
        assert calls == {"b": 1}
    run(main())


def test_a_step_name_used_twice_fails_the_run(tmp_path):
    @workflow("same_name")
    async def flow(ctx):
        await ctx.step("look", counted("look"))
        await ctx.step("look", counted("look"))

    async def main():
        engine = new_engine(tmp_path)
        run_id = engine.start("same_name", {})["id"]
        await settle(engine)
        assert engine.runs[run_id]["status"] == "failed"
        assert "used twice" in engine.runs[run_id]["error"]
    run(main())


def test_secret_inputs_stay_out_of_the_journal_and_are_typed_in_place(tmp_path):
    seen = {}

    def type_it():
        seen["typing"] = dict(TYPING_SECRETS.get())
        return "typed"

    @workflow("with_secret", secret_inputs=("value",))
    async def flow(ctx, name, value):
        seen["value"] = value
        return await ctx.step("type", type_it)

    async def main():
        engine = new_engine(tmp_path)
        run_id = engine.start("with_secret", {"name": "API_KEY", "value": "s3cret-value-123"})["id"]
        secret_file = tmp_path / "runs" / run_id / "secret-inputs.json"
        assert stat.S_IMODE(os.stat(secret_file).st_mode) == 0o600
        await settle(engine)
        assert engine.runs[run_id]["status"] == "completed"
        assert seen["value"] == "{{value}}"  # the workflow only ever has the placeholder
        assert seen["typing"] == {"{{value}}": "s3cret-value-123"}  # the browser types the value
        assert engine.runs[run_id]["input"]["value"] == "{{value}}"
        assert not secret_file.exists()  # gone once the run ends
        for path in (tmp_path / "runs" / run_id).iterdir():
            assert "s3cret-value-123" not in path.read_text()
    run(main())


def test_the_guard_refuses_a_secret_in_a_step_result(tmp_path):
    @workflow("leaky", secret_inputs=("value",))
    async def flow(ctx, value):
        return await ctx.step("leak", lambda: "the value is s3cret-value-123")

    async def main():
        engine = new_engine(tmp_path)
        run_id = engine.start("leaky", {"value": "s3cret-value-123"})["id"]
        await settle(engine)
        assert engine.runs[run_id]["status"] == "failed"
        for path in (tmp_path / "runs" / run_id).iterdir():
            assert "s3cret-value-123" not in path.read_text()
    run(main())


def test_the_guard_refuses_a_live_view_link(tmp_path):
    @workflow("link")
    async def flow(ctx):
        return await ctx.step("link", lambda: "https://api.steel.dev/v1/sessions/abc/player/tok.en")

    async def main():
        engine = new_engine(tmp_path)
        run_id = engine.start("link", {})["id"]
        await settle(engine)
        assert engine.runs[run_id]["status"] == "failed"
        assert "/player/" not in (tmp_path / "runs" / run_id / "events.jsonl").read_text()
    run(main())


def test_a_takeover_pause_keeps_the_browser_and_hides_its_session(tmp_path):
    @workflow("takeover")
    async def flow(ctx):
        answer = await ctx.take_over_browser("session-123", "Sign in, then continue")
        return answer

    @workflow("next_in_line")
    async def other(ctx):
        return await ctx.step("x", counted("x"))

    async def main():
        engine = new_engine(tmp_path)
        first = engine.start("takeover", {})["id"]
        await settle(engine)
        assert engine.takeover_session(first) == "session-123"
        assert "session_id" not in engine.public(engine.runs[first])["pause"]
        second = engine.start("next_in_line", {})["id"]
        await settle(engine)
        assert engine.runs[second]["status"] == "queued"  # the first run still has the browser
        engine.resume(first, "approved")
        await settle(engine)
        assert engine.runs[first]["output"] == "continued"
        assert engine.runs[second]["status"] == "completed"
        assert "browser.takeover.started" in types(engine, first)
        assert "browser.takeover.ended" in types(engine, first)
        assert engine.takeover_session(first) is None
    run(main())


def test_an_approval_lets_the_next_run_use_the_browser(tmp_path):
    @workflow("approval_only")
    async def flow(ctx):
        return await ctx.wait_for_user("Create it?", input_type="approval")

    @workflow("quick")
    async def other(ctx):
        return await ctx.step("x", counted("x"))

    async def main():
        engine = new_engine(tmp_path)
        engine.start("approval_only", {})
        await settle(engine)
        second = engine.start("quick", {})["id"]
        await settle(engine)
        assert engine.runs[second]["status"] == "completed"
    run(main())


def test_answers_are_checked(tmp_path):
    @workflow("choose")
    async def flow(ctx):
        return await ctx.wait_for_user("Which?", input_type="select",
                                       options=[{"id": "created", "label": "Created"},
                                                {"id": "not_created", "label": "Not created"}])

    async def main():
        engine = new_engine(tmp_path)
        run_id = engine.start("choose", {})["id"]
        await settle(engine)
        with pytest.raises(ValueError):
            engine.resume(run_id, "approved")
        engine.resume(run_id, "created")
        await settle(engine)
        assert engine.runs[run_id]["output"] == "created"
        with pytest.raises(ValueError):
            engine.resume(run_id, "created")  # not waiting any more
    run(main())


def test_progress_inside_a_step_becomes_events_on_that_step(tmp_path):
    def narrated():
        with progress.step("Opening the Secrets page"):
            progress.event("click at (10, 20)")
        return "ok"

    @workflow("narrated")
    async def flow(ctx):
        return await ctx.step("look_1", narrated)

    async def main():
        engine = new_engine(tmp_path)
        run_id = engine.start("narrated", {})["id"]
        await settle(engine)
        updates = [e for e in engine.journals[run_id].events if e["type"] == "progress.update"]
        assert [u["data"]["kind"] for u in updates] == ["step", "event", "step"]
        assert {u["step"] for u in updates} == {"look_1"}
        assert updates[1]["data"]["message"] == "click at (10, 20)"
    run(main())
