"""create_secret: add a project secret in Studio through its UI, the way a person would.

If Studio is signed out, a person signs in through a live browser on the run page. The run
then carries on by itself and pauses for a person to approve the write. The value is
generated for the run and is a secret input: this code only ever sees its placeholder, and
the browser types the real value in its place. Once Studio lists the secret, the run pauses
one last time while the person copies the value, the only place it's ever shown.

Workflow code decides every pause, and each step closes its browser and returns a status,
so a crash costs one step: finished steps replay from the journal, and the write looks
before it acts.
"""
import re
import secrets

from config import save_profile_id, saved_profile_id
from login_window import LoginWindow, close_login_window, open_login_window
from runtime import workflow
from studio_secrets import add_secret, look_for_secret

MAX_LOGINS = 3
NAME = re.compile(r"^[A-Z][A-Z0-9_]*$")


def new_value() -> str:
    """A strong value for a new secret: 43 URL-safe characters, 256 bits."""
    return secrets.token_urlsafe(32)


def check_input(inputs: dict) -> str | None:
    """What's wrong with a run's input, in a sentence, or None. The value is generated unless given."""
    if not NAME.match(str(inputs.get("name", ""))):
        return "name must be UPPER_SNAKE_CASE, like MY_API_KEY"
    environments = inputs.get("environments")
    if not (isinstance(environments, list) and environments and all(isinstance(e, str) and e for e in environments)):
        return "environments must list at least one environment, such as All Environments"
    if "value" in inputs and (not isinstance(inputs["value"], str) or not inputs["value"]):
        return "value must not be empty; leave it out to have one generated"
    return None


def open_login(profile_id: str | None) -> dict:
    """Open Studio's sign-in page in an interactive browser, left running for the person."""
    window = open_login_window(profile_id)
    if window.profile_id != profile_id:  # the first login creates the profile
        save_profile_id(window.profile_id)
    return {"session_id": window.session_id, "profile_id": window.profile_id}


def close_login(session_id: str, profile_id: str) -> dict:
    """Close the sign-in browser, which saves the login to the profile."""
    return {"saved": close_login_window(LoginWindow(session_id, profile_id, "", ""))}


@workflow("create_secret", secret_inputs=("value",), generated_inputs={"value": new_value})
async def create_secret(ctx, name: str, environments: list[str], value: str) -> dict:
    profile = await ctx.step("profile", saved_profile_id)
    for attempt in range(1, MAX_LOGINS + 2):
        look = await ctx.step(f"look_{attempt}", look_for_secret, profile, name)
        if look["status"] != "needs_login":
            break
        if attempt > MAX_LOGINS:
            return {"name": name, "status": "login_failed"}
        window = await ctx.step(f"open_login_window_{attempt}", open_login, profile)
        profile = window["profile_id"]
        answer = await ctx.take_over_browser(window["session_id"], "Sign in to Studio in the browser, then press Continue.")
        await ctx.step(f"close_login_window_{attempt}", close_login, window["session_id"], profile)
        if answer != "continued":
            return {"name": name, "status": "cancelled"}
    if look["status"] == "listed":
        return {"name": name, "status": "exists"}
    if look["status"] != "not_listed":
        return {"name": name, "status": "unrecognised", "detail": look.get("missing", "")}

    where = ", ".join(environments)
    decision = await ctx.wait_for_user(
        f"Create the secret **{name}** in Studio, for {where}?", input_type="approval",
        options=[{"id": "approve", "label": "Create secret"}, {"id": "reject", "label": "Don't create"}])
    if decision != "approved":
        return {"name": name, "status": "declined"}

    made = await ctx.step("create", add_secret, profile, name, where, value)  # value is the placeholder
    if made["status"] == "exists":
        return {"name": name, "environments": environments, "status": "exists"}
    if made["status"] in ("not_submitted", "needs_login", "unrecognised"):
        return {"name": name, "status": made["status"], **({"why": made["why"]} if made.get("why") else {})}
    back = await ctx.step("read_back", look_for_secret, profile, name)
    if back["status"] != "listed":
        checked = await ctx.wait_for_user(
            f"Studio may or may not have created **{name}**. Check its Secrets page: is it there?", input_type="select",
            options=[{"id": "created", "label": "It's there"}, {"id": "not_created", "label": "It isn't"}])
        if checked != "created":
            return {"name": name, "environments": environments, "status": "not_created"}
    await ctx.hand_over_secret("value", f"Copy the value of **{name}** now. This is the only place it's shown, and it's "
                                        "deleted from this machine once you confirm.")
    return {"name": name, "environments": environments, "status": "created"}
