"""The run server: starts workflows, streams their events, and takes people's answers.

    uv run python server.py     then open the address it prints

The routes follow AGNT5's naming, and the resume route is AGNT5's own, so the web app could
point at AGNT5 later. The server listens on localhost only. Every route needs the session
cookie, which the page gets by presenting the token printed at start, because one route hands
out the live view link of a signed-in browser.
"""
import asyncio
import json
import os
import secrets
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

import workflows
from config import STATE_DIR, saved_profile_id
from progress import progress
from runtime import WORKFLOWS, Engine
from steel_session import client, release_stale_sessions

PORT = int(os.environ.get("RUNNER_PORT", "8790"))
WEB_DIST = Path(__file__).resolve().parent.parent / "web" / "dist"
COOKIE = "runner_session"
FINISHED = ("completed", "failed")

progress.enabled = False  # progress goes into the runs' events, not this terminal
engine = Engine(STATE_DIR)
TOKEN = os.environ.get("RUNNER_TOKEN") or secrets.token_urlsafe(24)


@asynccontextmanager
async def lifespan(app: FastAPI):
    engine.loop = asyncio.get_running_loop()
    engine.load()
    # A runner that died mid-step left its browser holding the profile; close those first,
    # but not a sign-in browser a person may still be using.
    keep = frozenset(filter(None, (engine.takeover_session(run_id) for run_id in engine.runs)))
    if any(run["status"] in ("running", "queued") for run in engine.runs.values()):
        closed = await asyncio.to_thread(release_stale_sessions, saved_profile_id(), keep)
        if closed:
            print(f"Closed {closed} browser session(s) a stopped runner left open.", flush=True)
    engine.restart()
    yield


app = FastAPI(title="browser-prototype runner", lifespan=lifespan)


def signed_in(request: Request) -> None:
    if not secrets.compare_digest(request.cookies.get(COOKIE, ""), TOKEN):
        raise HTTPException(401, "Open the address the runner printed to sign in.")


def find(run_id: str) -> dict:
    if run_id not in engine.runs:
        raise HTTPException(404, "There's no run with that ID.")
    return engine.runs[run_id]


@app.post("/v1/session")
async def sign_in(body: dict, response: Response):
    if not secrets.compare_digest(str(body.get("token", "")), TOKEN):
        raise HTTPException(401, "That token isn't this runner's.")
    response.set_cookie(COOKIE, TOKEN, httponly=True, samesite="strict", path="/")
    return {"signed_in": True}


@app.get("/v1/workflows", dependencies=[Depends(signed_in)])
async def list_workflows():
    return [{"name": name, "secret_inputs": list(spec["secret_inputs"])} for name, spec in WORKFLOWS.items()]


@app.post("/v1/runs", dependencies=[Depends(signed_in)])
async def start_run(body: dict):
    name, inputs = body.get("workflow"), body.get("input") or {}
    if name not in WORKFLOWS:
        raise HTTPException(404, f"There's no workflow called {name!r}.")
    problem = workflows.INPUT_CHECKS.get(name, lambda _: None)(inputs)
    if problem:
        raise HTTPException(422, problem)
    return engine.public(engine.start(name, inputs))


@app.get("/v1/runs", dependencies=[Depends(signed_in)])
async def list_runs():
    return [engine.public(run) for run in sorted(engine.runs.values(), key=lambda r: r["created"], reverse=True)]


@app.get("/v1/runs/{run_id}", dependencies=[Depends(signed_in)])
async def get_run(run_id: str):
    return engine.public(find(run_id))


@app.get("/v1/runs/{run_id}/events", dependencies=[Depends(signed_in)])
async def get_events(run_id: str):
    find(run_id)
    return engine.journals[run_id].since(0)


def sse(event: dict) -> str:
    return f"id: {event['seq']}\ndata: {json.dumps(event)}\n\n"


@app.get("/v1/runs/{run_id}/stream", dependencies=[Depends(signed_in)])
async def stream(run_id: str, request: Request):
    """The run's events as server-sent events: history first, then live, until the run ends."""
    find(run_id)
    last = int(request.headers.get("last-event-id") or request.query_params.get("after") or 0)
    queue = engine.subscribe(run_id)

    async def events():
        sent = last
        try:
            for event in engine.journals[run_id].since(last):
                yield sse(event)
                sent = event["seq"]
            while engine.runs[run_id]["status"] not in FINISHED or not queue.empty():
                if await request.is_disconnected():
                    return
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=15)
                except asyncio.TimeoutError:
                    yield ": still here\n\n"
                    continue
                if event["seq"] > sent:
                    yield sse(event)
                    sent = event["seq"]
        finally:
            engine.unsubscribe(run_id, queue)

    return StreamingResponse(events(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})


@app.post("/v1/workflows/resume/{run_id}", dependencies=[Depends(signed_in)])
async def resume(run_id: str, body: dict):
    find(run_id)
    try:
        return engine.public(engine.resume(run_id, str(body.get("user_response", ""))))
    except ValueError as error:
        raise HTTPException(409, str(error))


@app.get("/v1/runs/{run_id}/browser", dependencies=[Depends(signed_in)])
async def browser(run_id: str):
    """The live view link of the browser a person should use now, and only while the run waits on them."""
    find(run_id)
    session_id = engine.takeover_session(run_id)
    if not session_id:
        raise HTTPException(404, "This run isn't waiting for anyone in a browser.")
    session = await asyncio.to_thread(client().sessions.retrieve, session_id)
    if session.status != "live":
        raise HTTPException(410, "That browser has closed. Press Continue, and the run will check where it stands.")
    engine.journals[run_id].watch_for(session.debug_url)  # the journal refuses it from now on
    return JSONResponse({"url": f"{session.debug_url}?interactive=true"}, headers={"Cache-Control": "no-store"})


if WEB_DIST.exists():
    app.mount("/", StaticFiles(directory=WEB_DIST, html=True), name="web")


if __name__ == "__main__":
    import uvicorn

    web = os.environ.get("WEB_URL", f"http://localhost:{PORT}")
    print(f"Runner listening on 127.0.0.1:{PORT}.\nOpen {web}/#token={TOKEN}", flush=True)
    uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="warning")
