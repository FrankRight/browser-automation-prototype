"""Runs workflows the way AGNT5 does, on one machine.

Each run keeps its events in its journal, and its status in `run.json`, under
`state/runs/<id>/`. A pause ends the run's task until a person answers; the answer runs
the workflow again from the top, and finished steps replay from the journal. After a
restart, runs that were going start again the same way.

Inputs a workflow marks secret never reach the journal: the run's recorded input holds a
placeholder such as `{{value}}`, the value itself waits in a private file until the run
ends, and the browser types it in the placeholder's place.

One run uses the browser at a time, because runs share the saved Steel profile. A run
waiting on an approval lets the next one go; a run waiting on a person in the browser doesn't.
"""
import asyncio
import json
import os
import secrets
from collections import defaultdict
from pathlib import Path

from computer_use import TYPING_SECRETS
from progress import progress_sink

from .context import WORKFLOWS, Pause, WorkflowContext, current_step
from .journal import GuardError, Journal, now


def placeholder(field: str) -> str:
    return "{{" + field + "}}"


class Engine:
    def __init__(self, state_dir: Path):
        self.dir = state_dir / "runs"
        self.dir.mkdir(parents=True, exist_ok=True)
        self.runs: dict[str, dict] = {}
        self.journals: dict[str, Journal] = {}
        self.listeners: dict[str, set[asyncio.Queue]] = defaultdict(set)
        self.loop: asyncio.AbstractEventLoop | None = None
        self.holder: str | None = None  # the run using the browser
        self.waiting: list[str] = []
        self.tasks: dict[str, asyncio.Task] = {}

    # Records

    def _save(self, run: dict) -> None:
        run["updated"] = now()
        path = self.dir / run["id"] / "run.json"
        temp = path.with_suffix(".tmp")
        temp.write_text(json.dumps(run, indent=1))
        os.replace(temp, path)

    def _secrets_path(self, run_id: str) -> Path:
        return self.dir / run_id / "secret-inputs.json"

    def _secret_inputs(self, run_id: str) -> dict:
        path = self._secrets_path(run_id)
        return json.loads(path.read_text()) if path.exists() else {}

    def _watch(self, run_id: str) -> None:
        for value in self._secret_inputs(run_id).values():
            self.journals[run_id].watch_for(value)

    @staticmethod
    def public(run: dict) -> dict:
        """A run as the API shows it: the pause without its browser session."""
        pause = run.get("pause")
        return {**run, "pause": pause and {k: v for k, v in pause.items() if k != "session_id"}}

    # Events

    def emit(self, run_id: str, type_: str, step: str | None = None, data: dict | None = None) -> dict:
        """Record an event and pass it to anyone watching the run. Safe to call from step threads."""
        event = self.journals[run_id].append(run_id, type_, step, data)
        for queue in list(self.listeners[run_id]):
            self.loop.call_soon_threadsafe(queue.put_nowait, event)
        return event

    def subscribe(self, run_id: str) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue()
        self.listeners[run_id].add(queue)
        return queue

    def unsubscribe(self, run_id: str, queue: asyncio.Queue) -> None:
        self.listeners[run_id].discard(queue)

    # Running

    def start(self, name: str, inputs: dict) -> dict:
        spec = WORKFLOWS[name]
        inputs = {**{field: make() for field, make in spec["generated_inputs"].items() if field not in inputs}, **inputs}
        run_id = f"run_{secrets.token_hex(6)}"
        (self.dir / run_id).mkdir(parents=True)
        hidden = {field: inputs[field] for field in spec["secret_inputs"] if field in inputs}
        if hidden:
            fd = os.open(self._secrets_path(run_id), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "w") as file:
                json.dump(hidden, file)
        shown = {**inputs, **{field: placeholder(field) for field in hidden}}
        run = {"id": run_id, "workflow": name, "status": "queued", "created": now(), "updated": now(),
               "input": shown, "output": None, "error": None, "pause": None}
        self.runs[run_id] = run
        self.journals[run_id] = Journal(self.dir / run_id)
        self._watch(run_id)
        self._save(run)
        self.emit(run_id, "run.started", data={"workflow": name, "input": shown})
        self._schedule(run_id)
        return run

    def resume(self, run_id: str, response: str) -> dict:
        run = self.runs[run_id]
        pause = run.get("pause")
        if run["status"] != "awaiting_user_input" or not pause:
            raise ValueError("the run isn't waiting for an answer")
        allowed = {"approval": ("approved", "rejected"),
                   "select": tuple(option["id"] for option in pause["options"])}.get(pause["input_type"])
        if allowed and response not in allowed:
            raise ValueError(f"the answer must be one of {', '.join(allowed)}")
        key = pause["step_key"]
        self.emit(run_id, "run.resumed", step=key, data={"step_key": key, "user_response": response})
        self.emit(run_id, "workflow.step.completed", step=key, data={"name": key, "output": response})
        if pause["takeover"]:
            self.emit(run_id, "browser.takeover.ended", step=key, data={"step_key": key})
        if pause.get("handover"):
            self.emit(run_id, "secret.handover.ended", step=key, data={"step_key": key})
        run["pause"] = None
        self._save(run)
        self._schedule(run_id)
        return run

    def takeover_session(self, run_id: str) -> str | None:
        """The browser session a person should use now, while the run waits on them in it."""
        pause = self.runs.get(run_id, {}).get("pause")
        return pause.get("session_id") if pause and pause.get("takeover") else None

    def handover_value(self, run_id: str) -> tuple[str, str] | None:
        """The secret a person should copy now, as (field, value), while the run waits on them to."""
        pause = self.runs.get(run_id, {}).get("pause")
        field = pause.get("handover") if pause else None
        value = self._secret_inputs(run_id).get(field) if field else None
        return (field, value) if value else None

    def recover(self) -> None:
        """Load every run, then start again the ones that were going when the runner stopped."""
        self.load()
        self.restart()

    def load(self) -> None:
        """Load every run's record, starting nothing."""
        for path in sorted(self.dir.glob("*/run.json")):
            run = json.loads(path.read_text())
            self.runs[run["id"]] = run
            self.journals[run["id"]] = Journal(path.parent)
            self._watch(run["id"])

    def restart(self) -> None:
        """Start again the runs that were going, oldest first, after any run that holds the browser."""
        by_age = sorted(self.runs.values(), key=lambda r: r["created"])
        for run in by_age:
            if run["status"] == "awaiting_user_input" and (run.get("pause") or {}).get("takeover"):
                self.holder = run["id"]
        for run in by_age:
            if run["status"] in ("running", "queued"):
                self._schedule(run["id"])

    def _schedule(self, run_id: str) -> None:
        run = self.runs[run_id]
        if self.holder in (None, run_id):
            self.holder = run_id
            run["status"] = "running"
            self._save(run)
            self.tasks[run_id] = self.loop.create_task(self._execute(run_id))
        else:
            if run_id not in self.waiting:
                self.waiting.append(run_id)
            run["status"] = "queued"
            self._save(run)

    def _release(self, run_id: str) -> None:
        if self.holder == run_id:
            self.holder = None
            if self.waiting:
                self._schedule(self.waiting.pop(0))

    async def _execute(self, run_id: str) -> None:
        run = self.runs[run_id]
        spec = WORKFLOWS[run["workflow"]]
        hidden = self._secret_inputs(run_id)
        ctx = WorkflowContext(run_id, self.journals[run_id],
                              lambda type_, step=None, data=None: self.emit(run_id, type_, step, data))
        sink = progress_sink.set(lambda payload: self.emit(run_id, "progress.update", current_step.get(), payload))
        typing = TYPING_SECRETS.set({placeholder(field): value for field, value in hidden.items()})
        try:
            output = await spec["fn"](ctx, **run["input"])
            self.emit(run_id, "run.completed", data={"output": output})
            run.update(status="completed", output=output)
        except Pause as pause:
            run.update(status="awaiting_user_input", pause=pause.info)
            self._save(run)
            if not pause.info["takeover"]:
                self._release(run_id)
            return
        except Exception as error:
            message = f"{type(error).__name__}: {error}"[:500]
            try:
                self.emit(run_id, "run.failed", data={"error": message})
            except GuardError:
                message = "the run failed, and its error held a secret, so it isn't shown"
                self.emit(run_id, "run.failed", data={"error": message})
            run.update(status="failed", error=message)
        finally:
            progress_sink.reset(sink)
            TYPING_SECRETS.reset(typing)
        self._save(run)
        self._secrets_path(run_id).unlink(missing_ok=True)
        self._release(run_id)
