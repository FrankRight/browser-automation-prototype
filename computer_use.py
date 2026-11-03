"""A computer-use loop: an OpenAI model looks at Steel screenshots and decides the input.

The step's code picks the page and the goal; the model only works the screen and
answers in text. Screenshots stay in memory and are never written to disk.
"""
import time

from openai import OpenAI

from config import openai_key

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
        steel.sessions.computer(session_id, action="type_text", text=action.text)
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


def work_screen(steel, session_id, goal: str, *, max_turns: int = 20, budget_s: float = 240) -> str:
    """Show the model the goal and the screen, run its actions, and return its final answer.

    A stalled request is retried after 90 s, and the whole task stops after budget_s, well
    inside the Steel session's own time limit, so a slow model can't hold the session open.
    """
    ai = OpenAI(api_key=openai_key(), timeout=90, max_retries=2)
    deadline = time.monotonic() + budget_s
    request = dict(model=MODEL, tools=[{"type": "computer"}], truncation="auto")
    response = ai.responses.create(**request, input=[{"role": "user", "content": [
        {"type": "input_text", "text": goal},
        {"type": "input_image", "image_url": _screen(steel, session_id), "detail": "original"},
    ]}])
    for _ in range(max_turns):
        if time.monotonic() > deadline:
            raise TimeoutError(f"the model didn't finish within {budget_s:.0f} s")
        calls = [item for item in response.output if item.type == "computer_call"]
        if not calls:
            return response.output_text
        outputs = []
        for call in calls:
            if getattr(call, "pending_safety_checks", None):
                raise SafetyCheck("; ".join(c.message or c.code for c in call.pending_safety_checks))
            for action in getattr(call, "actions", None) or [call.action]:
                _perform(steel, session_id, action)
            outputs.append({"type": "computer_call_output", "call_id": call.call_id, "output": {
                "type": "computer_screenshot", "image_url": _screen(steel, session_id), "detail": "original"}})
        response = ai.responses.create(**request, previous_response_id=response.id, input=outputs)
    raise TimeoutError(f"the model gave no answer after {max_turns} turns")
