"""Every event the runner records is one the contract lists, so the web app knows them all."""
import asyncio
import json
from pathlib import Path

from progress import progress
from runtime import WORKFLOWS, Engine, workflow

CONTRACT = json.loads((Path(__file__).resolve().parents[3] / "packages" / "contract" / "events.json").read_text())


def test_recorded_event_types_are_all_in_the_contract(tmp_path):
    saved = dict(WORKFLOWS)

    def narrated():
        with progress.step("Opening a page"):
            progress.update("waiting for the page")
            progress.event("click at (1, 2)")
        return "ok"

    @workflow("everything")
    async def everything(ctx):
        await ctx.step("narrated", narrated)
        await ctx.take_over_browser("session-1", "Sign in")
        await ctx.wait_for_user("Go on?", input_type="approval")
        await ctx.hand_over_secret("value", "Copy it")
        await ctx.step("boom", lambda: 1 / 0)

    async def main():
        engine = Engine(tmp_path)
        engine.loop = asyncio.get_running_loop()
        run_id = engine.start("everything", {})["id"]
        for answer in ("approved", "approved", "approved"):
            while engine.runs[run_id]["status"] != "awaiting_user_input":
                await asyncio.sleep(0.01)
            engine.resume(run_id, answer)
        while engine.runs[run_id]["status"] != "failed":
            await asyncio.sleep(0.01)
        return {e["type"] for e in engine.journals[run_id].events}

    try:
        recorded = asyncio.run(main())
    finally:
        WORKFLOWS.clear()
        WORKFLOWS.update(saved)
    assert recorded <= set(CONTRACT["types"]), recorded - set(CONTRACT["types"])
    assert recorded == set(CONTRACT["types"]) - {"run.completed"}  # this run fails, so it never completes
