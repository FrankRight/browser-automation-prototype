"""Steel browser sessions: each action opens one, does one thing, and releases it.

Sessions are headful and honest: no generated fingerprint, CAPTCHA solving, proxies or
simulated human movement. Steel's Input API drives the browser; no browser-automation
library is involved.
"""
import base64
import struct
import time
from contextlib import contextmanager

from steel import Steel

from config import SCREEN, steel_key

NO_DISGUISE = {"skip_fingerprint_injection": True, "humanize_interactions": False, "auto_captcha_solving": False}


def client() -> Steel:
    return Steel(steel_api_key=steel_key())


def wait_for_profile(steel: Steel, profile_id: str, timeout_s: int = 120) -> str:
    """Wait until Steel has saved the profile; a new session can't load it before then (409)."""
    deadline = time.monotonic() + timeout_s
    while (status := steel.profiles.get(profile_id).status) == "UPLOADING" and time.monotonic() < deadline:
        time.sleep(2)
    return status


@contextmanager
def open_session(*, profile_id=None, persist_profile=False, interactive=False, timeout_ms=300_000):
    """A live session, released when the block ends, even after an error.

    With a profile, keep persist_profile on: Studio's sign-in cookies change as they're
    used, and a session that doesn't save them back leaves the profile with stale ones.
    """
    steel = client()
    options = dict(
        headless=False,
        dimensions=SCREEN,
        solve_captcha=False,
        stealth_config=NO_DISGUISE,
        debug_config={"interactive": interactive},
        api_timeout=timeout_ms,
        persist_profile=persist_profile,
    )
    if profile_id:
        options["profile_id"] = profile_id
    session = steel.sessions.create(**options)
    try:
        yield steel, session
    finally:
        steel.sessions.release(session.id)
        if persist_profile and session.profile_id:
            wait_for_profile(steel, session.profile_id)


def screenshot(steel: Steel, session_id: str) -> bytes:
    shot = steel.sessions.computer(session_id, action="take_screenshot")
    return base64.b64decode(shot.base64_image)


def wait_for_window(steel: Steel, session_id: str, timeout_s: float = 15) -> None:
    """Wait until the browser window is up: until then the screen is the bare desktop, at a
    different size, and keys typed into it are lost (a half-typed address can't be reached)."""
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        width, height = struct.unpack(">II", screenshot(steel, session_id)[16:24])  # PNG header
        if (width, height) == (SCREEN["width"], SCREEN["height"]):
            return
        time.sleep(0.5)
    raise TimeoutError("the browser window didn't appear")


def go_to(steel: Steel, session_id: str, url: str) -> bytes:
    """Open a URL the way a person would: focus the address bar, type, press Enter."""
    wait_for_window(steel, session_id)
    steel.sessions.computer(session_id, action="press_key", keys=["Control", "l"])
    steel.sessions.computer(session_id, action="type_text", text=url)
    steel.sessions.computer(session_id, action="press_key", keys=["Enter"])
    steel.sessions.computer(session_id, action="wait", duration=3)
    return screenshot(steel, session_id)
