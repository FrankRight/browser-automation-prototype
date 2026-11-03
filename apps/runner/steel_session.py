"""Steel browser sessions: each action opens one, does one thing, and releases it.

Sessions are headful and honest: no generated fingerprint, CAPTCHA solving, proxies or
simulated human movement. Steel's Input API drives the browser; no browser-automation
library is involved.
"""
import base64
import struct
import time
from contextlib import contextmanager

from steel import NotFoundError, Steel

from config import SCREEN, steel_key
from progress import progress

NO_DISGUISE = {"skip_fingerprint_injection": True, "humanize_interactions": False, "auto_captcha_solving": False}


def client() -> Steel:
    return Steel(steel_api_key=steel_key())


def wait_for_profile(steel: Steel, profile_id: str, saved_by: str, settle_s: float = 15, timeout_s: float = 120) -> str:
    """Wait until Steel has saved the profile from session `saved_by`.

    Right after a release the profile still says READY from its previous save. A session
    started then loads that older copy, and its own save overwrites the newer one, so a
    login made in the released session is lost. Steel records which session saved last;
    a save usually lands about 1.5 s after the release. Steel doesn't save every session,
    though (one released within a second wasn't), so after settle_s with no save from
    this session and nothing uploading, it returns "UNCHANGED" instead of waiting on.
    """
    started = time.monotonic()
    while True:
        profile = steel.profiles.get(profile_id)
        waited = time.monotonic() - started
        if profile.status == "FAILED" or (profile.status == "READY" and profile.source_session_id == saved_by):
            return profile.status
        if profile.status == "READY" and waited > settle_s:
            return "UNCHANGED"
        if waited > timeout_s:
            raise TimeoutError(f"Steel was still saving the profile after {timeout_s:.0f} s")
        time.sleep(1)


def saved_note(status: str) -> str:
    """wait_for_profile's answer, in words for the terminal."""
    return {"READY": "profile saved", "UNCHANGED": "Steel didn't save the profile"}.get(status, f"profile {status.lower()}")


def release_stale_sessions(profile_id: str | None, keep: frozenset[str] = frozenset()) -> int:
    """Release live sessions a crashed run left holding the profile. Steel would keep them until
    their timeout, and a second session on the same profile can save over the first one's work.
    Sessions in `keep`, such as a sign-in browser a person may be using, stay open."""
    if not profile_id:
        return 0
    steel = client()
    page = steel.sessions.list()
    sessions = getattr(page, "sessions", None) or getattr(page, "data", None) or list(page)
    stale = [s for s in sessions if s.status == "live" and s.profile_id == profile_id and s.id not in keep]
    for session in stale:
        progress.update("closing a session a crashed run left")
        try:
            steel.sessions.release(session.id)
        except NotFoundError:
            continue
        progress.update("waiting for Steel to save the profile")
        wait_for_profile(steel, profile_id, saved_by=session.id)
    return len(stale)


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
    with progress.step("Starting a browser on Steel"):
        session = steel.sessions.create(**options)
    try:
        progress.event(f"Watch it on Steel: {session.session_viewer_url}")  # needs a Steel sign-in
        yield steel, session
    finally:
        with progress.step("Closing the browser"):
            try:
                steel.sessions.release(session.id)
            except NotFoundError:  # already gone: timed out or failed to start
                pass
            if persist_profile and session.profile_id:
                progress.update("waiting for Steel to save the profile")
                progress.note(saved_note(wait_for_profile(steel, session.profile_id, saved_by=session.id)))


def screenshot(steel: Steel, session_id: str) -> bytes:
    shot = steel.sessions.computer(session_id, action="take_screenshot")
    return base64.b64decode(shot.base64_image)


def wait_for_window(steel: Steel, session_id: str, timeout_s: float = 15) -> None:
    """Wait until the browser window is up: until then the screen is the bare desktop, at a
    different size, and keys typed into it are lost (a half-typed address can't be reached)."""
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        try:
            width, height = struct.unpack(">II", screenshot(steel, session_id)[16:24])  # PNG header
        except NotFoundError:  # a brand-new session can answer 404 for a moment while it starts
            width = height = None
        if (width, height) == (SCREEN["width"], SCREEN["height"]):
            return
        time.sleep(0.5)
    raise TimeoutError("the browser window didn't appear")


def go_to(steel: Steel, session_id: str, url: str, *, page: str | None = None) -> bytes:
    """Open a URL the way a person would: focus the address bar, type, press Enter.
    `page` names it on the terminal, as in "Opening the Runs page"."""
    with progress.step(f"Opening {page or url}"):
        progress.update("waiting for the browser window")
        wait_for_window(steel, session_id)
        progress.update("typing the address")
        steel.sessions.computer(session_id, action="press_key", keys=["Control", "l"])
        steel.sessions.computer(session_id, action="type_text", text=url)
        steel.sessions.computer(session_id, action="press_key", keys=["Enter"])
        progress.update("waiting for the page to load")
        steel.sessions.computer(session_id, action="wait", duration=3)
        return screenshot(steel, session_id)
