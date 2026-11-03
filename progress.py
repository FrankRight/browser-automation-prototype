"""Live progress on the terminal, so the person running the prototype, and anyone watching,
can see what it's doing behind the scenes.

Everything goes to stderr; stdout stays the JSON result. On a terminal, a spinner line shows
the current step, what it's doing and how long it has taken, and the steps that finish and
the model's actions stay printed above it. Anywhere else (a pipe or a log), the same
information comes as timestamped lines, with a line every few seconds while a step waits.

    with progress.step("Reading Studio's runs"):   # or as a decorator: @progress.step("...")
        progress.update("thinking, turn 2")        # what the step is doing now
        progress.event("click at (35, 210)")       # something that happened, kept on screen
"""
import itertools
import os
import sys
import threading
import time
from contextlib import contextmanager

FRAMES = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"
HEARTBEAT_S = 5  # without a terminal, the longest quiet spell before a line saying what's still going on


def duration(seconds: float) -> str:
    seconds = round(seconds)
    return f"{seconds // 60}m {seconds % 60:02d}s" if seconds >= 60 else f"{seconds}s"


def _columns() -> int:
    try:
        return os.get_terminal_size(sys.stderr.fileno()).columns or 100  # 0 when the terminal doesn't say
    except OSError:
        return 100


class _Step:
    def __init__(self, label: str, shown: bool):
        self.label = label
        self.started = time.monotonic()
        self.detail = ""  # what it's doing now
        self.note = ""  # added to its line when it finishes
        self.shown = shown  # its header line has been printed


class Progress:
    def __init__(self):
        self.enabled = True  # False with --quiet: only messages for the person are printed
        self.tty = sys.stderr.isatty()
        self.lock = threading.RLock()
        self.steps: list[_Step] = []  # the steps under way, outermost first
        self.paused = False
        self.started = time.monotonic()
        self.last_output = self.started
        self.waited_for_person = 0.0
        self.timings: list[tuple[str, float]] = []  # the top-level steps, as they finish
        self.spinner = None

    # Writing. Callers hold the lock.

    def _write(self, text: str) -> None:
        sys.stderr.write(text)
        sys.stderr.flush()
        self.last_output = time.monotonic()

    def _clear(self) -> None:
        if self.tty:
            self._write("\r\033[2K")

    def _print(self, text: str, depth: int) -> None:
        """A line that stays. On a terminal, a step's header is printed only once something is
        printed under it; until then the spinner line shows the step."""
        self._clear()
        stamp = "" if self.tty else time.strftime("%H:%M:%S ")
        for level, step in enumerate(self.steps[:depth]):
            if not step.shown:
                step.shown = True
                self._write(f"{stamp}{'  ' * level}▸ {step.label}\n")
        self._write(f"{stamp}{'  ' * depth}{text}\n")

    def _status(self) -> str:
        step = self.steps[-1]
        detail = f": {step.detail}" if step.detail else ""
        return f"{step.label}{detail} ({duration(time.monotonic() - step.started)})"

    def _tick(self, frame: str) -> None:
        if not self.steps or self.paused:
            return
        if self.tty:
            line = f"{'  ' * (len(self.steps) - 1)}{frame} {self._status()}"
            self._write("\r\033[2K" + line[: _columns() - 1])
        elif time.monotonic() - self.last_output >= HEARTBEAT_S:
            self._print(f"… {self._status()}", len(self.steps))

    def _spin(self) -> None:
        for frame in itertools.cycle(FRAMES):
            time.sleep(0.1)
            with self.lock:
                self._tick(frame)

    # What the rest of the program calls.

    @contextmanager
    def step(self, label: str):
        """A step of the run: shown while it's under way, then with ✓ (✗ if it raised) and its time."""
        if not self.enabled:
            yield
            return
        with self.lock:
            if self.spinner is None:
                self.spinner = threading.Thread(target=self._spin, daemon=True)
                self.spinner.start()
            if not self.tty:
                self._print(f"▸ {label}", len(self.steps))
            self.steps.append(_Step(label, shown=not self.tty))
        finished = False
        try:
            yield
            finished = True
        finally:
            with self.lock:
                step = self.steps.pop()
                took = time.monotonic() - step.started
                if not self.steps:
                    self.timings.append((step.label, took))
                note = f", {step.note}" if step.note else ""
                self._print(f"{'✓' if finished else '✗'} {step.label} ({duration(took)}{note})", len(self.steps))

    def update(self, detail: str) -> None:
        """What the current step is doing now: on the spinner line, or a line of its own without a terminal."""
        if not self.enabled or not self.steps:
            return
        with self.lock:
            if detail != self.steps[-1].detail:
                self.steps[-1].detail = detail
                if not self.tty:
                    self._print(detail, len(self.steps))

    def event(self, text: str) -> None:
        """Something that happened, kept on screen under the current step: a model action, a link to watch."""
        if self.enabled:
            with self.lock:
                self._print(f"· {text}", len(self.steps))

    def note(self, text: str) -> None:
        """A few words added to the current step's line when it finishes."""
        if self.enabled and self.steps:
            with self.lock:
                self.steps[-1].note = text

    def say(self, text: str) -> None:
        """A message for the person, printed even with --quiet."""
        with self.lock:
            self._clear()
            self._write(text + "\n")

    @contextmanager
    def waiting_for_person(self):
        """While the terminal waits for the person's answer: no spinner over the prompt, and the time is counted."""
        with self.lock:
            self.paused = True
            self._clear()
        started = time.monotonic()
        try:
            yield
        finally:
            with self.lock:
                self.waited_for_person += time.monotonic() - started
                self.paused = False

    def timing_summary(self) -> str:
        """How long each top-level step took, as a small table; empty with --quiet."""
        if not self.enabled or not self.timings:
            return ""
        width = max(len(label) for label, _ in self.timings)
        lines = ["Time taken:"] + [f"  {label:<{width}}  {duration(took):>7}" for label, took in self.timings]
        waited = (f", including {duration(self.waited_for_person)} waiting for you"
                  if self.waited_for_person >= 1 else "")
        lines.append(f"  {'Total':<{width}}  {duration(time.monotonic() - self.started):>7}{waited}")
        return "\n".join(lines)


progress = Progress()
