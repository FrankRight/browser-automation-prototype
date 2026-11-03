"""Seed the Steel profile with a Studio login, by hand, once.

    uv run python seed_profile.py start    # opens Studio's sign-in page in a session that saves its profile
    uv run python seed_profile.py finish   # after you've signed in: saves the login and records the profile ID

The live view links go to state/login-link.txt (mode 600), never to the output: anyone
with the debug link can control the session.
"""
import json
import os
import sys
import time

from config import SCREEN, STATE_DIR, STUDIO_URL, save_profile_id, saved_profile_id
from steel_session import NO_DISGUISE, client, go_to

SEED_FILE = STATE_DIR / "seed.json"
LINK_FILE = STATE_DIR / "login-link.txt"
LOGIN_TIMEOUT_MS = 15 * 60 * 1000  # the free plan's longest session


def write_private(path, text):
    STATE_DIR.mkdir(exist_ok=True)
    path.write_text(text)
    os.chmod(path, 0o600)


def start():
    steel = client()
    reuse = {"profile_id": saved_profile_id()} if saved_profile_id() else {}  # sign in to the same profile again
    session = steel.sessions.create(
        headless=False, dimensions=SCREEN, solve_captcha=False, stealth_config=NO_DISGUISE,
        debug_config={"interactive": True}, api_timeout=LOGIN_TIMEOUT_MS, persist_profile=True, **reuse,
    )
    go_to(steel, session.id, f"{STUDIO_URL}/login")
    write_private(SEED_FILE, json.dumps({"session_id": session.id, "profile_id": session.profile_id}))
    write_private(LINK_FILE, f"Steel dashboard (needs your Steel login): {session.session_viewer_url}\n"
                             f"Live view (anyone with this link can control the session): {session.debug_url}?interactive=true\n")
    print(f"login session started; open the links in {LINK_FILE}")
    print(f"it ends by itself at {time.strftime('%H:%M:%S', time.localtime(time.time() + LOGIN_TIMEOUT_MS / 1000))}")
    print("profile ID recorded:", bool(session.profile_id))


def finish():
    seed = json.loads(SEED_FILE.read_text())
    steel = client()
    if steel.sessions.retrieve(seed["session_id"]).status == "live":
        steel.sessions.release(seed["session_id"])  # releasing saves the browser's data to the profile
    for _ in range(60):
        status = steel.profiles.get(seed["profile_id"]).status
        if status != "UPLOADING":
            break
        time.sleep(2)
    print("profile status:", status)
    if status == "READY":
        save_profile_id(seed["profile_id"])
        SEED_FILE.unlink()
        LINK_FILE.unlink(missing_ok=True)
        print("saved the profile ID to state/profile.json")


if __name__ == "__main__":
    {"start": start, "finish": finish}[sys.argv[1]]()
