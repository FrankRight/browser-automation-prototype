"""Test helper: sign the saved Steel profile out of Studio, so the login pause can be tried.

    uv run python sign_out.py
"""
from config import STUDIO_URL, saved_profile_id
from steel_session import go_to, open_session

if __name__ == "__main__":
    profile_id = saved_profile_id()
    if not profile_id:
        raise SystemExit("there's no saved profile to sign out")
    with open_session(profile_id=profile_id, persist_profile=True) as (steel, session):
        go_to(steel, session.id, f"{STUDIO_URL}/logout")
        steel.sessions.computer(session.id, action="wait", duration=3)
    print("signed the saved profile out of Studio")
