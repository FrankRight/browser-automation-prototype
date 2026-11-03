"""The login pause's browser: a Steel session on Studio's sign-in page, for a person to use.

open_login_window starts the session with the saved profile (or a new one) and returns
its links; close_login_window releases it, which saves the login to the profile. Neither
writes the live view link anywhere: anyone holding it can control the session.
"""
from dataclasses import dataclass

from config import SCREEN, STUDIO_URL
from steel_session import NO_DISGUISE, client, go_to, wait_for_profile

LOGIN_TIMEOUT_MS = 15 * 60 * 1000  # the free plan's longest session


@dataclass
class LoginWindow:
    session_id: str
    profile_id: str
    dashboard_url: str  # Steel's own viewer, behind a Steel sign-in
    live_view_url: str  # works for anyone who has it


def open_login_window(profile_id: str | None, *, timeout_ms: int = LOGIN_TIMEOUT_MS) -> LoginWindow:
    steel = client()
    reuse = {"profile_id": profile_id} if profile_id else {}
    session = steel.sessions.create(
        headless=False, dimensions=SCREEN, solve_captcha=False, stealth_config=NO_DISGUISE,
        debug_config={"interactive": True}, api_timeout=timeout_ms, persist_profile=True, **reuse,
    )
    try:
        go_to(steel, session.id, f"{STUDIO_URL}/login")
    except Exception:
        steel.sessions.release(session.id)
        raise
    return LoginWindow(session.id, session.profile_id, session.session_viewer_url,
                       f"{session.debug_url}?interactive=true")


def is_open(window: LoginWindow) -> bool:
    """Still running? The session ends by itself at its timeout, and Steel still saves the profile then."""
    return client().sessions.retrieve(window.session_id).status == "live"


def close_login_window(window: LoginWindow) -> str:
    """Release the session if it's still running, then wait for Steel to save the profile."""
    steel = client()
    if steel.sessions.retrieve(window.session_id).status == "live":
        steel.sessions.release(window.session_id)
    return wait_for_profile(steel, window.profile_id, saved_by=window.session_id)
