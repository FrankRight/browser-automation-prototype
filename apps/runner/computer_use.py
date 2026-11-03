"""A computer-use loop: an OpenAI model looks at Steel screenshots and decides the input.

The step's code picks the page and the goal; the model only works the screen and
answers in text. Screenshots stay in memory and are never written to disk.

Each turn is shown on the terminal as it happens: how long the model thought, then its
actions, described from the structured action, never from the model's text, which could
repeat something private from the screen. Typed text is shown only when the caller says
it's safe to; otherwise just its length.
"""
import secrets
import threading
import time
from contextvars import ContextVar

from openai import APIConnectionError, OpenAI

from config import openai_key
from progress import duration, progress

MODEL = "gpt-6.1-sol"

# OpenAI key names to the DOM key names Steel's Input API expects.
KEYS = {
    "CTRL": "Control", "CONTROL": "Control", "CMD": "Meta", "META": "Meta", "SUPER": "Meta",
    "ALT": "Alt", "OPTION": "Alt", "SHIFT": "Shift", "ENTER": "Enter", "RETURN": "Enter",
    "ESC": "Escape", "ESCAPE": "Escape", "TAB": "Tab", "SPACE": " ", "BACKSPACE": "Backspace",
    "DELETE": "Delete", "HOME": "Home", "END": "End", "PAGEUP": "PageUp", "PAGEDOWN": "PageDown",
    "UP": "ArrowUp", "DOWN": "ArrowDown", "LEFT": "ArrowLeft", "RIGHT": "ArrowRight",
    "ARROWUP": "ArrowUp", "ARROWDOWN": "ArrowDown", "ARROWLEFT": "ArrowLeft", "ARROWRIGHT": "ArrowRight",
}
BUTTONS = {"left": "left", "right": "right", "wheel": "middle", "middle": "middle", "back": "back", "forward": "forward"}
MODIFIERS = {"Control": "Ctrl", "Meta": "Cmd", "Alt": "Alt"}
TURN_TIMEOUT_S = 60  # healthy turns took 31 s at most (191 measured); one still going after this is given up and tried again
TURN_TRIES = 3

# Placeholders the model may type in place of a secret, and the values sent instead. The run
# server sets this for a run; the model only ever sees and types the placeholder.
TYPING_SECRETS: ContextVar = ContextVar("typing_secrets", default={})


class SafetyCheck(Exception):
    """The model flagged an action for a person to approve; this loop never approves on its own."""


def _screen(steel, session_id) -> str:
    image = steel.sessions.computer(session_id, action="take_screenshot").base64_image
    return f"data:image/png;base64,{image}"


def _perform(steel, session_id, action) -> None:
    kind = action.type
    if kind in ("click", "double_click"):
        steel.sessions.computer(
            session_id, action="click_mouse", coordinates=[action.x, action.y],
            button=BUTTONS.get(getattr(action, "button", None) or "left", "left"),
            **({"num_clicks": 2} if kind == "double_click" else {}),
        )
    elif kind == "scroll":
        steel.sessions.computer(session_id, action="scroll", coordinates=[action.x, action.y],
                                delta_x=action.scroll_x or 0, delta_y=action.scroll_y or 0)
    elif kind == "type":
        text = action.text
        for placeholder, value in TYPING_SECRETS.get().items():
            text = text.replace(placeholder, value)
        steel.sessions.computer(session_id, action="type_text", text=text)
    elif kind == "keypress":
        steel.sessions.computer(session_id, action="press_key", keys=[KEYS.get(k.upper(), k) for k in action.keys])
    elif kind == "move":
        steel.sessions.computer(session_id, action="move_mouse", coordinates=[action.x, action.y])
    elif kind == "drag":
        steel.sessions.computer(session_id, action="drag_mouse", path=[[p.x, p.y] for p in action.path])
    elif kind == "wait":
        steel.sessions.computer(session_id, action="wait", duration=1)
    elif kind != "screenshot":
        raise ValueError(f"unsupported computer action: {kind}")


def _describe(action, show_typed) -> str:
    """An action in a few words, for the terminal."""
    kind = action.type
    if kind in ("click", "double_click"):
        button = getattr(action, "button", None) or "left"
        click = "double-click" if kind == "double_click" else "click"
        return f"{'' if button == 'left' else button + '-'}{click} at ({action.x}, {action.y})"
    if kind == "scroll":
        dx, dy = action.scroll_x or 0, action.scroll_y or 0
        ways = ([f"{'down' if dy > 0 else 'up'} {abs(dy)} px"] if dy else []) + \
               ([f"{'right' if dx > 0 else 'left'} {abs(dx)} px"] if dx else [])
        return f"scroll {' and '.join(ways) or 'by 0 px'} at ({action.x}, {action.y})"
    if kind == "type":
        return f'type "{action.text}"' if action.text in show_typed else f"type {len(action.text)} characters (not shown)"
    if kind == "keypress":
        keys = [KEYS.get(k.upper(), k) for k in action.keys]
        if not MODIFIERS.keys() & set(keys) and all(len(k) == 1 for k in keys if k != "Shift"):
            return "press a character key (not shown)"  # that's typing
        return "press " + "+".join(MODIFIERS.get(k, k.upper() if len(k) == 1 else k) for k in keys)
    if kind == "move":
        return f"move the mouse to ({action.x}, {action.y})"
    if kind == "drag":
        return f"drag from ({action.path[0].x}, {action.path[0].y}) to ({action.path[-1].x}, {action.path[-1].y})"
    if kind == "wait":
        return "wait 1s"
    return "take a screenshot" if kind == "screenshot" else kind


def _opening(goal: str, screen: str) -> list[dict]:
    """The goal, then the screen as the answer to a screenshot the model asked for. Shown the
    screen as a plain image instead, the model spends its first turn asking for a screenshot;
    given it this way, it acts straight away."""
    call_id = secrets.token_hex(12)
    return [
        {"role": "user", "content": [{"type": "input_text", "text": goal}]},
        {"type": "computer_call", "id": f"cu_{call_id}", "call_id": f"call_{call_id}", "status": "completed",
         "pending_safety_checks": [], "actions": [{"type": "screenshot"}]},
        {"type": "computer_call_output", "call_id": f"call_{call_id}",
         "output": {"type": "computer_screenshot", "image_url": screen, "detail": "original"}},
    ]


def _stream(ai, request: dict, on_text, outcome: dict, given_up: threading.Event) -> None:
    """One try at a streamed turn: puts the finished response, or the error, in outcome."""
    text = ""
    try:
        with ai.responses.create(**request, stream=True) as events:
            for event in events:
                if given_up.is_set():  # this try ran out of time, and another has started
                    return
                if event.type == "response.output_text.delta":
                    text += event.delta
                    on_text(text)
                elif event.type in ("response.completed", "response.failed", "response.incomplete"):
                    outcome["response"] = event.response
                    return
    except Exception as error:
        outcome["error"] = error


def _respond(ai, request: dict, on_text):
    """responses.create, streamed so the terminal can follow the model while it writes its
    answer. Returns the finished response, as create does.

    A stream can stay open without ever finishing, which no read timeout catches, so each
    try runs on its own thread and is given up after TURN_TIMEOUT_S. A try that times out
    or loses its connection is tried again; any other API error is raised, as create's is.
    """
    for _ in range(TURN_TRIES):
        outcome, given_up = {}, threading.Event()
        worker = threading.Thread(target=_stream, args=(ai, request, on_text, outcome, given_up), daemon=True)
        worker.start()
        worker.join(TURN_TIMEOUT_S)
        given_up.set()
        if "response" in outcome:
            return outcome["response"]
        if "error" in outcome and not isinstance(outcome["error"], APIConnectionError):
            raise outcome["error"]
    raise TimeoutError(f"the model didn't finish a turn in {TURN_TRIES} tries of {TURN_TIMEOUT_S} s")


def work_screen(steel, session_id, goal: str, *, show_typed=frozenset(), answer_progress=None,
                max_turns: int = 20, budget_s: float = 240) -> str:
    """Show the model the goal and the screen, run its actions, and return its final answer.

    show_typed is the text the model may type that's safe to show on the terminal, such as
    an approved name. answer_progress turns the answer written so far into a few words for
    the terminal, such as how many runs it lists; by default it's "writing its answer". A
    stalled request is retried after 90 s, and the whole task stops after budget_s, well
    inside the Steel session's own time limit, so a slow model can't hold the session open.
    """
    ai = OpenAI(api_key=openai_key(), timeout=90, max_retries=2)
    deadline = time.monotonic() + budget_s
    request = dict(model=MODEL, tools=[{"type": "computer"}], truncation="auto")
    writing = answer_progress or (lambda text: "writing its answer")
    thinking = []  # how long the model took each turn

    def turn(**turn_input):
        progress.update(f"thinking, turn {len(thinking) + 1}")
        started = time.monotonic()
        response = _respond(ai, {**request, **turn_input}, lambda text: progress.update(writing(text)))
        thinking.append(time.monotonic() - started)
        return response

    response = turn(input=_opening(goal, _screen(steel, session_id)))
    for _ in range(max_turns):
        if time.monotonic() > deadline:
            raise TimeoutError(f"the model didn't finish within {budget_s:.0f} s")
        calls = [item for item in response.output if item.type == "computer_call"]
        if not calls:
            progress.event(f"thought {duration(thinking[-1])} → answered", thought_ms=round(thinking[-1] * 1000),
                           actions=[{"type": "answer", "label": "Answered"}])
            progress.note(f"{len(thinking)} turn{'s' * (len(thinking) != 1)}, {duration(sum(thinking))} thinking")
            return response.output_text
        outputs = []
        for call in calls:
            if getattr(call, "pending_safety_checks", None):
                raise SafetyCheck("; ".join(c.message or c.code for c in call.pending_safety_checks))
            actions = getattr(call, "actions", None) or [call.action]
            described = [_describe(a, show_typed) for a in actions]
            progress.event(f"thought {duration(thinking[-1])} → " + ", ".join(described), thought_ms=round(thinking[-1] * 1000),
                           actions=[{"type": a.type, "label": text} for a, text in zip(actions, described)])
            for action in actions:
                _perform(steel, session_id, action)
            outputs.append({"type": "computer_call_output", "call_id": call.call_id, "output": {
                "type": "computer_screenshot", "image_url": _screen(steel, session_id), "detail": "original"}})
        response = turn(previous_response_id=response.id, input=outputs)
    raise TimeoutError(f"the model gave no answer after {max_turns} turns")
