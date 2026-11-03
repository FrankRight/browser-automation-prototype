# Browser automation prototype

A plain Python program that uses a website through its screens, in a full, visible browser on [Steel](https://steel.dev). Steel's Input API sends the mouse and keyboard actions, and an OpenAI computer-use model reads the screen and decides them. No browser-automation library is involved.

Its first job is a check on [AGNT5](https://agnt5.com) Studio: read a project's 20 newest finished runs from the Runs page, as plain data, using a saved sign-in.

## Set up

```bash
uv sync
cat > .env.local <<'EOF'
STUDIO_URL=https://app.agnt5.com
STUDIO_PROJECT_ID=<the project to read>
OPENAI_ENV_FILE=<a dotenv file that sets OPENAI_API_KEY>
EOF
chmod 600 .env.local
```

`.env.local` is git-ignored. Environment variables win over it. Put the Steel key in `~/.steel-key` (mode 600), or set `STEEL_API_KEY`; set `OPENAI_API_KEY` directly instead of `OPENAI_ENV_FILE` if you prefer. Keys are read inside the program and never printed.

## Run it

```bash
uv run python seed_profile.py start    # once: opens Studio's sign-in page in a Steel session
#   sign in through the link in state/login-link.txt, then:
uv run python seed_profile.py finish   # saves the sign-in to a Steel profile
uv run python read_runs.py             # prints the 20 newest finished runs as JSON
```

`read_runs.py` prints `{"status": "needs_login"}` when the saved sign-in has expired (seed it again), or `{"status": "unrecognised", ...}` when it can't find the runs table.

## How it works

| File | What it does |
|---|---|
| `steel_session.py` | Opens one Steel session per action and always releases it. Sessions are headful, with no generated fingerprint, CAPTCHA solving, proxies or simulated mouse movement. |
| `computer_use.py` | The loop between the model and the screen. It stops on a safety check instead of approving it, and keeps screenshots in memory. |
| `read_runs.py` | Opens the Runs page, has the model read 20 finished runs, and returns them as plain data, `needs_login` or `unrecognised`. |
| `seed_profile.py` | Signs the Steel profile in to Studio by hand, through the session's live view. |
| `config.py` | Settings, keys, screen size, and where the profile ID is kept (`state/`, git-ignored, mode 600). |

## What we learned

- **Save the profile back after every session** (`persist_profile=True`). A session that only loads it leaves stale sign-in cookies behind, and the next session lands on the sign-in page.
- **Wait for the browser window before typing.** Keys sent while the desktop is still starting are lost, and a half-typed address can't be reached.
- **Studio's runs table doesn't show run IDs.** Its TIME column is when the run was enqueued, in the browser's time zone (New York on Steel), and DURATION is the API's `total_time_ms`.
- **Steel generates a browser fingerprint unless told not to.** Sessions here set `skip_fingerprint_injection`. Steel also records every session, and SDK 0.19 has no switch to turn that off.
- **The live view link needs care.** Anyone holding a session's debug URL can control it, so the program writes it to a mode-600 file instead of printing it.
