"""The Studio check: read the project's runs, pausing for a person whenever Studio needs a login.

    uv run python studio_check.py

Messages for the person go to the terminal (stderr); the result is printed as JSON (stdout).
When the saved login is missing or expired, the program opens Studio's sign-in page in a
Steel session, shows its links, and waits for "done". After three "done" answers that
leave Studio signed out, it stops.
"""
import json
import sys
import time

from openai import APIError
from steel import APIError as SteelAPIError

from config import save_profile_id, saved_profile_id
from login_window import LOGIN_TIMEOUT_MS, close_login_window, is_open, open_login_window
from read_runs import read_runs

MAX_LOGINS = 3


def tell(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


def ask_terminal(prompt: str) -> str:
    """Like input(), but the prompt goes to stderr, so stdout carries only the result."""
    print(prompt, end="", file=sys.stderr, flush=True)
    line = sys.stdin.readline()
    if not line:
        raise EOFError
    return line


def wait_for_done(ask) -> None:
    while ask('Type "done" when you\'ve signed in: ').strip().lower() != "done":
        pass


def check(ask=ask_terminal) -> dict:
    profile_id = saved_profile_id()
    logins = 0
    while True:
        result = read_runs(profile_id)
        if result.get("status") != "needs_login":
            return result
        if logins == MAX_LOGINS:
            return {"status": "login_failed", "detail": f"Studio was still signed out after {MAX_LOGINS} logins"}
        window = open_login_window(profile_id)
        if window.profile_id != profile_id:  # the first login creates the profile
            profile_id = window.profile_id
            save_profile_id(profile_id)
        try:
            ends = time.strftime("%H:%M", time.localtime(time.time() + LOGIN_TIMEOUT_MS / 1000))
            tell(f"\nStudio needs you to sign in (login {logins + 1} of {MAX_LOGINS}).\n"
                 f"  Open the session in Steel: {window.dashboard_url}\n"
                 f"  Or its live view:          {window.live_view_url}\n"
                 f"  (anyone with the live view link can control the session, so don't share it)\n"
                 f"Sign in to Studio there. The session closes by itself at {ends}.")
            wait_for_done(ask)
            if is_open(window):
                logins += 1
            else:  # a session that timed out isn't the person's failed login, so it doesn't count
                tell("That sign-in session had already closed, so this try doesn't count.")
        finally:
            if close_login_window(window) == "UNCHANGED":  # releasing normally saves the login
                tell("Steel didn't save that sign-in session, so the login may not have been kept.")


if __name__ == "__main__":
    try:
        result = check()
    except (TimeoutError, APIError, SteelAPIError) as error:
        result = {"status": "unavailable", "detail": f"{type(error).__name__}: {error}"[:300]}
    except EOFError:
        result = {"status": "login_abandoned", "detail": "the terminal closed before anyone answered"}
    if result.get("status") == "login_failed":
        tell(f"\nStopped: {result['detail']}. Check the account, then run the check again.")
    json.dump(result, sys.stdout, indent=1)
    print()
    sys.exit(0 if result.get("status") == "ok" else 1)
