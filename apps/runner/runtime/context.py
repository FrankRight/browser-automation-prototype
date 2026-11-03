"""The workflow API, shaped like the AGNT5 Python SDK's, so a workflow written here moves to
AGNT5 by changing its imports.

    @workflow("create_secret")
    async def create_secret(ctx, name: str):
        found = await ctx.step("look_1", look_for_secret, name)
        answer = await ctx.wait_for_user("Create it?", input_type="approval")

A workflow runs again from the top whenever it resumes, as on AGNT5. Steps that finished
return their recorded results without running, so workflow code must decide the same way
each time, and anything that touches the outside world belongs in a step.
"""
import asyncio
import inspect
import time
from contextvars import ContextVar

from .journal import Journal

WORKFLOWS: dict = {}
current_step: ContextVar = ContextVar("current_step", default=None)


def workflow(name: str, *, secret_inputs: tuple[str, ...] = (), generated_inputs: dict | None = None):
    """Register an async workflow function under a name, like AGNT5's @workflow.

    secret_inputs name the inputs that must never be recorded: the workflow receives a
    placeholder for each, such as "{{value}}", and the browser types the real value in its place.
    generated_inputs make an input, when a run doesn't give it, such as a new secret's value.
    """
    def register(fn):
        if not inspect.iscoroutinefunction(fn):
            raise TypeError(f"workflow {name} must be an async function")
        WORKFLOWS[name] = {"fn": fn, "secret_inputs": tuple(secret_inputs), "generated_inputs": dict(generated_inputs or {})}
        return fn
    return register


class Pause(Exception):
    """Unwinds the workflow while it waits for a person. The run holds nothing meanwhile."""

    def __init__(self, info: dict):
        super().__init__(info["step_key"])
        self.info = info


APPROVAL_OPTIONS = [{"id": "approve", "label": "Approve"}, {"id": "reject", "label": "Reject"}]


class WorkflowContext:
    def __init__(self, run_id: str, journal: Journal, emit):
        self.run_id = run_id
        self._journal = journal
        self._emit = emit
        self._names: set[str] = set()
        self._waits = 0
        self._takeovers = 0
        self._handovers = 0

    async def step(self, name: str, fn, *args, **kwargs):
        """Run fn once and record its result; on replay, return the recorded result instead."""
        if name in self._names:
            raise ValueError(f"step name {name!r} is used twice; give each call its own name")
        self._names.add(name)
        done = self._journal.completed(name)
        if done is not None:
            return done["data"]["output"]
        self._emit("workflow.step.started", step=name, data={"name": name})
        started = time.monotonic()
        token = current_step.set(name)
        try:
            if inspect.iscoroutinefunction(fn):
                output = await fn(*args, **kwargs)
            else:
                output = await asyncio.to_thread(fn, *args, **kwargs)
        except Exception as error:
            self._emit("workflow.step.failed", step=name, data={
                "name": name, "error": f"{type(error).__name__}: {error}"[:500],
                "duration_ms": round((time.monotonic() - started) * 1000)})
            raise
        finally:
            current_step.reset(token)
        self._emit("workflow.step.completed", step=name, data={
            "name": name, "output": output, "duration_ms": round((time.monotonic() - started) * 1000)})
        return output

    async def wait_for_user(self, question: str, input_type: str = "text", options: list[dict] | None = None,
                            allow_custom: bool = False, skippable: bool = False) -> str | None:
        """Pause until a person answers. An approval answers "approved" or "rejected", as Studio's card does."""
        self._waits += 1
        if input_type == "approval" and not options:
            options = APPROVAL_OPTIONS
        return self._pause({"step_key": f"wait_for_user_{self._waits}", "question": question,
                            "input_type": input_type, "options": options or [], "allow_custom": allow_custom,
                            "skippable": skippable, "takeover": False, "handover": None})

    async def take_over_browser(self, session_id: str, question: str) -> str:
        """Pause while a person uses a live browser; "continued" or "cancelled".

        Not in the AGNT5 SDK: this is the pause the run page shows with the browser panel. The
        session ID stays in the run's state for the server, which fetches the live view link
        from Steel only when the panel asks; the journal never holds the link.
        """
        self._takeovers += 1
        answer = self._pause({"step_key": f"take_over_browser_{self._takeovers}", "question": question,
                              "input_type": "approval", "options": [{"id": "approve", "label": "Continue"},
                                                                    {"id": "reject", "label": "Cancel"}],
                              "allow_custom": False, "skippable": False, "takeover": True, "handover": None},
                             session_id=session_id)
        return "continued" if answer == "approved" else "cancelled"

    async def hand_over_secret(self, field: str, question: str) -> None:
        """Pause while a person copies a secret input, such as a value the run generated.

        Not in the AGNT5 SDK either: the run page shows the value only during this pause,
        fetched from the runner, and the journal never holds it. The value is deleted from
        this machine when the run ends, which it does once the person confirms.
        """
        self._handovers += 1
        self._pause({"step_key": f"hand_over_secret_{self._handovers}", "question": question,
                     "input_type": "approval", "options": [{"id": "approve", "label": "I've copied it"}],
                     "allow_custom": False, "skippable": False, "takeover": False, "handover": field})

    def _pause(self, info: dict, session_id: str | None = None):
        key = info["step_key"]
        done = self._journal.completed(key)
        if done is not None:
            return done["data"]["output"]
        if not self._journal.has("approval.requested", key):
            if info["takeover"]:
                self._emit("browser.takeover.started", step=key, data={"step_key": key})
            if info["handover"]:
                self._emit("secret.handover.started", step=key, data={"step_key": key, "field": info["handover"]})
            self._emit("workflow.step.started", step=key, data={"name": key, "type": "user_input"})
            self._emit("approval.requested", step=key, data={k: v for k, v in info.items() if k not in ("takeover", "handover")})
            self._emit("workflow.step.paused", step=key, data={"name": key, "reason": "user_input_required"})
            self._emit("run.paused", step=key, data={"step_key": key, "takeover": info["takeover"]})
        raise Pause({**info, "session_id": session_id})
