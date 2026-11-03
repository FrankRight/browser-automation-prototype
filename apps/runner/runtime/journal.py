"""A run's journal: the append-only file of its events, which is also what replay reads.

Every event is checked before it's written. The journal refuses anything holding a value
registered as secret for the run, a Steel live view link or a cookie, so a mistake fails
the run instead of leaking into the record.
"""
import json
import os
import re
import secrets
import threading
from datetime import datetime, timezone
from pathlib import Path

LIVE_VIEW_LINK = re.compile(r"steel\.dev/v1/sessions/[^\s\"/]+/player")
COOKIE = re.compile(r'"(cookie|set-cookie)"\s*:', re.IGNORECASE)
MIN_SECRET_LENGTH = 6  # shorter values would match ordinary text; the guard can't watch for them


class GuardError(Exception):
    """An event would have carried a secret into the journal."""


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


class Journal:
    def __init__(self, directory: Path):
        directory.mkdir(parents=True, exist_ok=True)
        self.path = directory / "events.jsonl"
        self.lock = threading.Lock()
        self.events: list[dict] = []
        if self.path.exists():
            self.events = [json.loads(line) for line in self.path.read_text().splitlines() if line.strip()]
        self.secrets: set[str] = set()

    def watch_for(self, value: str) -> None:
        """Refuse any event that contains this value from now on."""
        if value and len(value) >= MIN_SECRET_LENGTH:
            self.secrets.add(value)

    def check(self, text: str) -> None:
        if LIVE_VIEW_LINK.search(text):
            raise GuardError("refused to record a live view link")
        if any(value in text for value in self.secrets):
            raise GuardError("refused to record a secret value")
        if COOKIE.search(text):
            raise GuardError("refused to record a cookie")

    def append(self, run_id: str, type_: str, step: str | None = None, data: dict | None = None) -> dict:
        with self.lock:
            event = {"id": f"evt_{secrets.token_hex(8)}", "seq": len(self.events) + 1, "run_id": run_id,
                     "type": type_, "time": now(), "step": step, "data": data or {}}
            line = json.dumps(event, ensure_ascii=False)
            self.check(line)
            with self.path.open("a") as file:
                file.write(line + "\n")
                file.flush()
                os.fsync(file.fileno())
            self.events.append(event)
            return event

    def completed(self, step: str) -> dict | None:
        """The step's recorded completion, which replay returns instead of running it again."""
        return next((e for e in reversed(self.events) if e["type"] == "workflow.step.completed" and e["step"] == step), None)

    def has(self, type_: str, step: str | None = None) -> bool:
        return any(e["type"] == type_ and (step is None or e["step"] == step) for e in self.events)

    def since(self, seq: int) -> list[dict]:
        with self.lock:
            return [e for e in self.events if e["seq"] > seq]
