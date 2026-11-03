"""The Studio check: read the project's runs from Studio, check them against the AGNT5 API,
and, if they all match, create a service key the way a customer would.

    uv run python studio_check.py [--show-live-view-link] [--crash-after-create] [--quiet]

--show-live-view-link also prints a login session's live view link, which works for anyone
who has it; by default only Steel's dashboard link, behind a Steel sign-in, is shown.
--crash-after-create kills the program right after Studio creates the key, as `kill -9`
would, to show that the next run recovers without creating a second key.
--quiet leaves out the live progress and the timing table.

Messages for the person go to the terminal (stderr); the result is printed as JSON (stdout).
While it runs, the terminal shows each step, what it's doing, the model's actions and how
long each step took, and it ends with a table of where the time went.
When a browser step finds Studio signed out, the program opens Studio's sign-in page in a
Steel session, shows its links, and waits for "done". After three "done" answers that
leave Studio signed out, it stops.

An agent compares the runs with the API. Runs read from screenshots can be misread, so when
anything disagrees, the program reads Studio again and re-checks those runs: a disagreement
the second read doesn't repeat is reported as a misread, not a mismatch.

The service key is a real credential, so a person approves its exact name first. The
approved name is kept in state/ until the write is finished, so a run that crashed resumes
without a second approval, and the write step looks for the key before creating it. The
key is revoked at the end.
"""
import json
import os
import secrets
import sys
import time
from datetime import date

from openai import APIError
from steel import APIError as SteelAPIError

from agnt5_api import revoke_service_key, service_keys
from api_runs import RunIndex
from compare import compare, confirm, suspects
from config import STATE_DIR, save_profile_id, saved_profile_id
from create_key import create_service_key
from login_window import LOGIN_TIMEOUT_MS, close_login_window, is_open, open_login_window
from progress import progress
from read_runs import read_runs
from steel_session import release_stale_sessions

MAX_LOGINS = 3
SHOW_LIVE_VIEW_LINK = "--show-live-view-link" in sys.argv
MAX_WRITE_TRIES = 3
PENDING_WRITE = STATE_DIR / "write.json"  # the approved key name, until the write is done


def tell(message: str) -> None:
    progress.say(message)


def ask_terminal(prompt: str) -> str:
    """Like input(), but the prompt goes to stderr, so stdout carries only the result."""
    with progress.waiting_for_person():
        print(prompt, end="", file=sys.stderr, flush=True)
        line = sys.stdin.readline()
        if not sys.stdin.isatty():  # a piped answer isn't echoed: show it, and end the prompt's line
            print(line.rstrip("\n"), file=sys.stderr, flush=True)
    if not line:
        raise EOFError
    return line


def wait_for_done(ask) -> None:
    while ask('Type "done" when you\'ve signed in: ').strip().lower() != "done":
        pass


def with_login(step, ask) -> tuple[dict, str | None]:
    """Run a browser step, pausing for a person to sign in whenever it reports needs_login."""
    profile_id = saved_profile_id()
    logins = 0
    while True:
        result = step(profile_id)
        if result.get("status") != "needs_login":
            return result, profile_id
        if logins == MAX_LOGINS:
            return {"status": "login_failed", "detail": f"Studio was still signed out after {MAX_LOGINS} logins"}, profile_id
        progress.event("Studio is signed out")
        with progress.step("Signing in to Studio"):
            window = open_login_window(profile_id)
            if window.profile_id != profile_id:  # the first login creates the profile
                profile_id = window.profile_id
                save_profile_id(profile_id)
            try:
                ends = time.strftime("%H:%M", time.localtime(time.time() + LOGIN_TIMEOUT_MS / 1000))
                live_view = (f"  Or its live view:          {window.live_view_url}\n"
                             f"  (anyone with the live view link can control the session, so don't share it)\n"
                             if SHOW_LIVE_VIEW_LINK else "")
                tell(f"\nStudio needs you to sign in (login {logins + 1} of {MAX_LOGINS}).\n"
                     f"  Open the session in Steel: {window.dashboard_url}\n"
                     f"{live_view}"
                     f"Sign in to Studio there. The session closes by itself at {ends}.")
                wait_for_done(ask)
                if is_open(window):
                    logins += 1
                else:  # a session that timed out isn't the person's failed login, so it doesn't count
                    tell("That sign-in session had already closed, so this try doesn't count.")
            finally:
                if close_login_window(window) == "UNCHANGED":  # releasing normally saves the login
                    tell("Steel didn't save that sign-in session, so the login may not have been kept.")


def approved_key_name(ask) -> str | None:
    """The key name a person approved: resumed from an unfinished write, or asked for now."""
    if PENDING_WRITE.exists():
        name = json.loads(PENDING_WRITE.read_text())["name"]
        tell(f'\nResuming the approved write: service key "{name}".')
        return name
    name = f"studio-check-{date.today():%Y-%m-%d}-{secrets.token_hex(2)}"  # computed once, then kept
    try:
        answer = ask(f'\nThe runs match. Create the service key "{name}" in Studio? Type yes to approve: ')
    except EOFError:
        return None
    if answer.strip().lower() != "yes":
        return None
    STATE_DIR.mkdir(exist_ok=True)
    PENDING_WRITE.write_text(json.dumps({"name": name}))
    os.chmod(PENDING_WRITE, 0o600)
    return name


def write_key(ask) -> dict:
    name = approved_key_name(ask)
    if name is None:
        return {"status": "declined"}
    for _ in range(MAX_WRITE_TRIES):
        outcome, _ = with_login(lambda profile_id: create_service_key(profile_id, name), ask)
        if outcome["status"] in ("created", "exists"):
            break
        if outcome["status"] != "unclear":  # nothing was submitted; the approval stays for the next run
            return {**outcome, "name": name}
        reply = ""
        while reply not in ("created", "not created"):
            reply = ask(f'\nStudio may or may not have created "{name}". Check its Service keys page, '
                        f'then type "created" or "not created": ').strip().lower()
        if reply == "created":
            outcome = {"status": "created", "name": name, "confirmed_by": "person"}
            break
    else:
        return {"status": "unclear", "name": name, "detail": f"still unclear after {MAX_WRITE_TRIES} tries"}
    # Clean up: the key is a real credential and only a test of the write.
    with progress.step("Revoking the test key through the AGNT5 API"):
        keys = service_keys(name)
        for key in keys:
            if not key.get("revoked_at"):
                revoke_service_key(key["id"])
        revoked = all(key.get("revoked_at") for key in service_keys(name))
    PENDING_WRITE.unlink()
    return {**outcome, "keys_with_this_name": len(keys), "revoked": revoked}


def check(ask=ask_terminal) -> dict:
    with progress.step("Looking for browser sessions a crashed run left"):
        stale = release_stale_sessions(saved_profile_id())
        if stale:
            progress.note(f"closed {stale} that held the browser profile")
    result, profile_id = with_login(read_runs, ask)
    if result.get("status") != "ok":
        return result
    runs = result["runs"]
    with progress.step("Checking the runs against the AGNT5 API"):
        progress.update("fetching the project's runs from the API")
        index = RunIndex()
        first = compare(runs, index)
    survived, misreads = first, {"mismatches": [], "not_in_api": []}
    if suspects(first):
        progress.event(f"{len(suspects(first))} run(s) disagree with the API; reading Studio again to rule out misreads")
        again = read_runs(profile_id)
        if again.get("status") == "ok":
            with progress.step("Checking those runs again"):
                survived, misreads = confirm(first, again["runs"], index)
        else:
            progress.event(f"Couldn't read Studio again ({again.get('status')}), so these stay unconfirmed")
    problems = {m["time"] for m in survived["mismatches"]} | {n["time"] for n in survived["not_in_api"]}
    unchecked = {u["time"] for u in first["unchecked"]}
    report = {
        "status": "ok",
        "checked": len(runs) - len(unchecked),
        "matching": sum(1 for run in runs if run["time"] not in problems | unchecked),
        "mismatches": survived["mismatches"],
        "not_in_api": survived["not_in_api"],
        "misreads": misreads["mismatches"] + misreads["not_in_api"],
        "unchecked": first["unchecked"],
    }
    progress.event(f"{report['matching']} of {len(runs)} runs match the API")
    if problems or unchecked:
        report["write"] = {"status": "skipped", "detail": "the runs don't all match the API"}
    else:
        report["write"] = write_key(ask)
    report["runs"] = runs
    return report


def summary(result: dict) -> str:
    """The result in a sentence or two, for the person at the terminal."""
    if result.get("status") != "ok":
        return f"Stopped: {result.get('status')}. {result.get('detail', '')}".strip()
    lines = [f"Checked {result['checked']} runs: {result['matching']} match the API, "
             f"{len(result['mismatches'])} mismatch, {len(result['not_in_api'])} not in the API, "
             f"{len(result['misreads'])} misread and corrected."]
    write = result.get("write", {})
    outcomes = {"created": "created once, then revoked", "exists": "already there, so not created again; revoked",
                "declined": "not approved, so nothing was created", "skipped": "skipped, because the runs don't all match"}
    name = f' "{write["name"]}"' if write.get("name") else ""
    lines.append(f"Service key{name}: {outcomes.get(write.get('status'), write.get('status'))}.")
    return "\n".join(lines)


if __name__ == "__main__":
    import create_key
    create_key.CRASH_AFTER_CREATE = "--crash-after-create" in sys.argv
    progress.enabled = "--quiet" not in sys.argv
    try:
        result = check()
    except (TimeoutError, APIError, SteelAPIError) as error:
        result = {"status": "unavailable", "detail": f"{type(error).__name__}: {error}"[:300]}
    except EOFError:
        result = {"status": "login_abandoned", "detail": "the terminal closed before anyone answered"}
    if result.get("status") == "login_failed":
        tell(f"\nStopped: {result['detail']}. Check the account, then run the check again.")
    if progress.timing_summary():
        tell("\n" + progress.timing_summary())
    tell("\n" + summary(result))
    json.dump(result, sys.stdout, indent=1)
    print()
    sys.exit(0 if result.get("status") == "ok" else 1)
