"""The AGNT5 API calls the prototype makes: reading runs, and finding and revoking service keys."""
import json
import urllib.request

from config import STUDIO_API_URL, STUDIO_PROJECT_ID, studio_api_key


def request(method: str, path: str):
    req = urllib.request.Request(f"{STUDIO_API_URL}/api/v1{path}", method=method, headers={
        "X-API-KEY": studio_api_key(), "Accept": "application/json", "User-Agent": "browser-prototype"})
    with urllib.request.urlopen(req, timeout=30) as response:
        body = response.read()
    if not body.strip():
        return None
    parsed = json.loads(body)
    return parsed.get("data") if isinstance(parsed, dict) and "data" in parsed else parsed  # revoke replies without data


def service_keys(name: str) -> list[dict]:
    """The project's service keys with exactly this name, revoked and expired ones included
    (the list leaves them out unless asked)."""
    keys = request("GET", f"/service-keys?project_id={STUDIO_PROJECT_ID}"
                          "&include_revoked=true&include_expired=true&page_size=100") or []
    keys = keys if isinstance(keys, list) else (keys.get("keys") or keys.get("items") or keys.get("data") or [])
    return [key for key in keys if key.get("name") == name]


def revoke_service_key(key_id: str) -> None:
    request("POST", f"/service-keys/{key_id}/revoke")
