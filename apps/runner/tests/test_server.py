"""The run server's routes, with stand-in workflows: no browser, no model."""
import asyncio
import json
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

import server
from runtime import WORKFLOWS, Engine, workflow


@pytest.fixture
def client(tmp_path, monkeypatch):
    saved = dict(WORKFLOWS)

    @workflow("approve_me")
    async def approve_me(ctx):
        await ctx.step("prepare", lambda: "ready")
        return {"answer": await ctx.wait_for_user("Go on?", input_type="approval")}

    @workflow("sign_in_first")
    async def sign_in_first(ctx):
        return {"answer": await ctx.take_over_browser("session-42", "Sign in, then continue")}

    monkeypatch.setattr(server, "engine", Engine(tmp_path))
    with TestClient(server.app) as test_client:
        yield test_client
    WORKFLOWS.clear()
    WORKFLOWS.update(saved)


def sign_in(client):
    assert client.post("/v1/session", json={"token": server.TOKEN}).status_code == 200


def settle(client, run_id, status):
    for _ in range(200):
        run = client.get(f"/v1/runs/{run_id}").json()
        if run["status"] == status:
            return run
        import time
        time.sleep(0.01)
    raise AssertionError(f"run stayed {run['status']}, expected {status}")


def test_every_route_needs_the_session(client):
    assert client.get("/v1/runs").status_code == 401
    assert client.post("/v1/session", json={"token": "wrong"}).status_code == 401
    sign_in(client)
    assert client.get("/v1/runs").status_code == 200


def test_create_secret_input_is_checked(client):
    sign_in(client)
    bad = client.post("/v1/runs", json={"workflow": "create_secret",
                                        "input": {"name": "lower-case", "environments": ["All Environments"], "value": "x" * 8}})
    assert bad.status_code == 422
    assert "UPPER_SNAKE_CASE" in bad.json()["detail"]
    assert client.post("/v1/runs", json={"workflow": "nope", "input": {}}).status_code == 404


def test_a_paused_run_resumes_and_its_stream_ends_with_it(client):
    sign_in(client)
    run_id = client.post("/v1/runs", json={"workflow": "approve_me", "input": {}}).json()["id"]
    paused = settle(client, run_id, "awaiting_user_input")
    assert paused["pause"]["input_type"] == "approval"
    assert client.post(f"/v1/workflows/resume/{run_id}", json={"user_response": "maybe"}).status_code == 409
    assert client.post(f"/v1/workflows/resume/{run_id}", json={"user_response": "approved"}).status_code == 200
    done = settle(client, run_id, "completed")
    assert done["output"] == {"answer": "approved"}
    with client.stream("GET", f"/v1/runs/{run_id}/stream") as response:
        assert response.headers["cache-control"] == "no-store"
        events = [json.loads(line[6:]) for line in response.iter_lines() if line.startswith("data: ")]
    assert [e["seq"] for e in events] == list(range(1, len(events) + 1))
    assert events[-1]["type"] == "run.completed"
    assert "approval.requested" in [e["type"] for e in events]
    with client.stream("GET", f"/v1/runs/{run_id}/stream", headers={"Last-Event-ID": str(len(events) - 1)}) as response:
        rest = [json.loads(line[6:]) for line in response.iter_lines() if line.startswith("data: ")]
    assert [e["type"] for e in rest] == ["run.completed"]


def test_the_live_view_link_is_served_only_during_a_takeover(client, monkeypatch):
    sign_in(client)
    approve = client.post("/v1/runs", json={"workflow": "approve_me", "input": {}}).json()["id"]
    settle(client, approve, "awaiting_user_input")
    assert client.get(f"/v1/runs/{approve}/browser").status_code == 404
    client.post(f"/v1/workflows/resume/{approve}", json={"user_response": "rejected"})
    settle(client, approve, "completed")

    link = "https://api.steel.dev/v1/sessions/session-42/player/tok.en"
    fake = SimpleNamespace(sessions=SimpleNamespace(retrieve=lambda sid: SimpleNamespace(status="live", debug_url=link)))
    monkeypatch.setattr(server, "client", lambda: fake)
    run_id = client.post("/v1/runs", json={"workflow": "sign_in_first", "input": {}}).json()["id"]
    paused = settle(client, run_id, "awaiting_user_input")
    assert "session_id" not in paused["pause"]
    answer = client.get(f"/v1/runs/{run_id}/browser")
    assert answer.status_code == 200
    assert answer.json()["url"] == f"{link}?interactive=true"
    assert answer.headers["cache-control"] == "no-store"
    assert link in server.engine.journals[run_id].secrets  # the journal now refuses it
    client.post(f"/v1/workflows/resume/{run_id}", json={"user_response": "approved"})
    assert settle(client, run_id, "completed")["output"] == {"answer": "continued"}
    assert client.get(f"/v1/runs/{run_id}/browser").status_code == 404
    events = client.get(f"/v1/runs/{run_id}/events").json()
    assert "player" not in json.dumps(events)


def test_startup_closes_a_stopped_runners_browsers_but_keeps_a_sign_in(tmp_path, monkeypatch, capsys):
    saved = dict(WORKFLOWS)

    @workflow("was_going")
    async def was_going(ctx):
        return await ctx.step("x", lambda: "done")

    @workflow("signing_in")
    async def signing_in(ctx):
        return await ctx.take_over_browser("person-is-here", "Sign in")

    async def stopped_runner():
        # Leave records as a stopped runner would: one run waiting on a person in the browser,
        # and one queued behind it, because runs take turns with the browser.
        engine = Engine(tmp_path)
        engine.loop = asyncio.get_running_loop()
        waiting = engine.start("signing_in", {})["id"]
        while engine.runs[waiting]["status"] != "awaiting_user_input":
            await asyncio.sleep(0.01)
        queued = engine.start("was_going", {})["id"]
        assert engine.runs[queued]["status"] == "queued"
        return waiting, queued

    waiting, queued = asyncio.run(stopped_runner())
    released = []
    monkeypatch.setattr(server, "release_stale_sessions", lambda profile, keep: released.append(keep) or 2)
    monkeypatch.setattr(server, "engine", Engine(tmp_path))
    with TestClient(server.app) as test_client:
        sign_in(test_client)
        assert test_client.get(f"/v1/runs/{queued}").json()["status"] == "queued"  # still behind the sign-in
        test_client.post(f"/v1/workflows/resume/{waiting}", json={"user_response": "approved"})
        assert settle(test_client, waiting, "completed")["output"] == "continued"
        assert settle(test_client, queued, "completed")["output"] == "done"
    WORKFLOWS.clear()
    WORKFLOWS.update(saved)
    assert released == [frozenset({"person-is-here"})]  # the sign-in browser is kept open
    assert "Closed 2 browser session(s)" in capsys.readouterr().out
