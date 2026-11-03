"""The AGNT5 API's record of the project's runs, looked up the way Studio's Runs page labels them.

Studio's runs table shows no run IDs, so a run is found by its enqueue time: to the second,
in the browser's time zone, formatted like Studio's TIME column ("Oct 27, 13:01:14").
"""
from datetime import datetime
from zoneinfo import ZoneInfo

from agnt5_api import request
from config import BROWSER_TIME_ZONE, STUDIO_PROJECT_ID


def _get(path: str):
    return request("GET", path)


def as_studio_time(iso: str) -> str:
    when = datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(ZoneInfo(BROWSER_TIME_ZONE))
    return when.strftime("%b %-d, %H:%M:%S")


class RunIndex:
    """The project's runs across all its deployments, by Studio-formatted enqueue time."""

    def __init__(self):
        self.by_time: dict[str, list[dict]] = {}
        for deployment in _get(f"/deployments?project_id={STUDIO_PROJECT_ID}"):
            data = _get(f"/deployments/{deployment['id']}/runs?limit=200")
            for run in data if isinstance(data, list) else (data.get("runs") or data.get("items") or []):
                self.by_time.setdefault(as_studio_time(run["enqueued_at"]), []).append(run)

    def at(self, time: str) -> dict:
        """The get_run_summary tool's answer: the runs enqueued at that second."""
        return {"runs": [{"run_id": run["run_id"], "component": run["component_name"], "status": run["status"],
                          "total_time_ms": run["total_time_ms"]} for run in self.by_time.get(time.strip(), [])]}
