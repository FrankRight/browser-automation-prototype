"""Settings and keys for the browser prototype.

Settings come from the environment, or from `.env.local` next to this file (git-ignored).
Keys are read inside the program and never printed.

    STUDIO_URL          the AGNT5 Studio to use, e.g. https://app.agnt5.com
    STUDIO_PROJECT_ID   the project whose runs are read
    STUDIO_API_URL      the AGNT5 API behind that Studio, e.g. https://api.agnt5.com
    STUDIO_API_KEY      an AGNT5 API key that can read the project, or a file named by STUDIO_API_KEY_FILE
    BROWSER_TIME_ZONE   the time zone Studio's times are shown in (default America/New_York, Steel's)
    STEEL_API_KEY       or a file named by STEEL_KEY_FILE (default ~/.steel-key)
    OPENAI_API_KEY      or a dotenv file that sets it, named by OPENAI_ENV_FILE
"""
import json
import os
from pathlib import Path

HERE = Path(__file__).parent
SCREEN = {"width": 1280, "height": 800}
STATE_DIR = HERE / "state"  # git-ignored; holds the Steel profile ID
PROFILE_FILE = STATE_DIR / "profile.json"


def _dotenv(path: Path) -> dict[str, str]:
    values = {}
    if path.exists():
        for line in path.read_text().splitlines():
            name, sep, value = line.strip().removeprefix("export ").partition("=")
            if sep and name.strip() and not name.lstrip().startswith("#"):
                values[name.strip()] = value.strip().strip('"').strip("'")
    return values


_LOCAL = _dotenv(HERE / ".env.local")


def setting(name: str, default: str | None = None) -> str:
    value = os.environ.get(name) or _LOCAL.get(name) or default
    if not value:
        raise RuntimeError(f"{name} isn't set: put it in the environment or in .env.local")
    return value


STUDIO_URL = setting("STUDIO_URL").rstrip("/")
STUDIO_PROJECT_ID = setting("STUDIO_PROJECT_ID")
STUDIO_API_URL = setting("STUDIO_API_URL").rstrip("/")
BROWSER_TIME_ZONE = setting("BROWSER_TIME_ZONE", "America/New_York")


def studio_api_key() -> str:
    return os.environ.get("STUDIO_API_KEY") or Path(setting("STUDIO_API_KEY_FILE")).expanduser().read_text().strip()


def steel_key() -> str:
    return os.environ.get("STEEL_API_KEY") or Path(setting("STEEL_KEY_FILE", "~/.steel-key")).expanduser().read_text().strip()


def openai_key() -> str:
    key = os.environ.get("OPENAI_API_KEY") or _dotenv(Path(setting("OPENAI_ENV_FILE")).expanduser()).get("OPENAI_API_KEY")
    if not key:
        raise RuntimeError("OPENAI_API_KEY isn't set in the environment or in the OPENAI_ENV_FILE file")
    return key


def saved_profile_id() -> str | None:
    return json.loads(PROFILE_FILE.read_text())["profile_id"] if PROFILE_FILE.exists() else None


def save_profile_id(profile_id: str) -> None:
    STATE_DIR.mkdir(exist_ok=True)
    PROFILE_FILE.write_text(json.dumps({"profile_id": profile_id}))
    os.chmod(PROFILE_FILE, 0o600)  # the profile holds a signed-in browser
