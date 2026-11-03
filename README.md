# Browser automation prototype

A plain Python program that uses a website through its screens, in a full, visible browser on [Steel](https://steel.dev). Steel's Input API sends the mouse and keyboard actions, and an OpenAI computer-use model reads the screen and decides them. No browser-automation library is involved.

Its first job is a check on [AGNT5](https://agnt5.com) Studio: read a project's 20 newest finished runs from the Runs page, as plain data, using a saved sign-in, have an agent check them against the AGNT5 API, and, if they all match, create a service key the way a customer would, once, after a person approves it.

## Set up

```bash
uv sync
cat > .env.local <<'EOF'
STUDIO_URL=https://app.agnt5.com
STUDIO_PROJECT_ID=<the project to read>
STUDIO_API_URL=https://api.agnt5.com
STUDIO_API_KEY_FILE=<a file holding an AGNT5 API key that can read the project>
OPENAI_ENV_FILE=<a dotenv file that sets OPENAI_API_KEY>
EOF
chmod 600 .env.local
```

`.env.local` is git-ignored. Environment variables win over it. Put the Steel key in `~/.steel-key` (mode 600), or set `STEEL_API_KEY`; set `OPENAI_API_KEY` directly instead of `OPENAI_ENV_FILE` if you prefer. Keys are read inside the program and never printed.

## Run it

```bash
uv run python studio_check.py
```

It prints a JSON report: how many of the 20 newest finished runs were checked and matched the API, every `mismatch` field by field with both values, runs `not_in_api`, and `misreads`. When the agent finds a disagreement, the program reads Studio again and re-checks those runs; a disagreement the second read doesn't repeat was the first read getting the screen wrong, so it's listed as a misread rather than a mismatch. When there's no saved sign-in yet, or it has expired, it pauses: it opens Studio's sign-in page in a Steel session, shows you the session's links in the terminal, and waits for you to sign in there and type `done`. After three `done` answers that leave Studio signed out, it stops with `{"status": "login_failed"}`. Other results: `unrecognised` when it can't find the runs table, and `unavailable` when the model or Steel doesn't answer in time.

When every run matches, it asks you to approve creating a service key with an exact, one-off name (`studio-check-<date>-<4 hex>`). Type `yes` to create it; anything else creates nothing. The write looks before it acts: if Studio already lists a key with that name, it doesn't create another. The approved name is kept in `state/` until the write finishes, so a run that crashes resumes it without asking again, and a run releases any Steel session a crashed run left holding the profile. It can't tell those from another run's sessions, so run one check at a time. If it can't tell whether Studio created the key, it asks you to check Studio and type `created` or `not created`. The key is revoked at the end; it only exists to test the write.

While it runs, the terminal shows what it's doing: each step with a spinner and the time it has taken, the model's clicks, typing and scrolling as they happen, and a link to watch each browser session on Steel. It ends with a table of where the time went. Typed text is shown only when it's the approved key name, and nothing the model writes is shown, because it could repeat something private from the screen. Without a terminal (in a pipe or a log), the same comes as timestamped lines. `--quiet` leaves the progress out.

`uv run python sign_out.py` signs the saved profile out of Studio, to try the login pause.

## Run the demo

1. **A normal run.** `uv run python studio_check.py`, then type `yes` at the approval. It reads the runs, checks them against the API, creates the key once and revokes it, then sums up in two lines. About two minutes.
2. **The login pause.** `uv run python sign_out.py`, then `uv run python studio_check.py`. Open the Steel dashboard link it prints, sign in to Studio there, and type `done`. The run carries on without a restart. (`--show-live-view-link` also prints the session's live view link, which works for anyone who has it.)
3. **A crash, and recovery.** `uv run python studio_check.py --crash-after-create`, then `yes`: it dies right after Studio creates the key, as `kill -9` would. Run `uv run python studio_check.py` again: it releases the session the crash left, resumes the approved write without asking again, finds the key instead of creating a second one, and revokes it.

To watch the browser while it works, open the "Watch it on Steel" link the terminal prints when each session starts (it needs a Steel sign-in). Don't show it on a shared screen while the key's dialog is open: Studio shows the new key's value there once.

## How it works

| File | What it does |
|---|---|
| `steel_session.py` | Opens one Steel session per action and always releases it. Sessions are headful, with no generated fingerprint, CAPTCHA solving, proxies or simulated mouse movement. |
| `computer_use.py` | The loop between the model and the screen. It stops on a safety check instead of approving it, and keeps screenshots in memory. |
| `studio_check.py` | The program: reads the runs, pausing for a person whenever Studio needs a login, then checks them against the API. |
| `compare.py` | The comparison step: an agent looks each run up with a `get_run_summary` tool and reports disagreements in a fixed JSON shape. It never touches the browser, and it treats what it was shown as data. |
| `create_key.py` | The write step: looks for a key with the approved name, creates it through Studio's dialog if there's none, and reads the list back. Returns `exists`, `created`, `unclear`, `needs_login` or `not_submitted`. Only the model's JSON answer is read, so a key's value shown on screen can't come back through its text. |
| `agnt5_api.py` | The AGNT5 API calls: reading runs, and finding and revoking service keys. |
| `api_runs.py` | The tool's lookup: the project's runs from the AGNT5 API, keyed by enqueue time as Studio shows it. |
| `read_runs.py` | The read step: opens the Runs page, has the model read 20 finished runs, and returns them as plain data, `needs_login` or `unrecognised`. |
| `login_window.py` | Opens Studio's sign-in page in a Steel session for a person, and releases it afterwards, which saves the login to the profile. |
| `sign_out.py` | Test helper: signs the saved profile out of Studio. |
| `progress.py` | The live progress on the terminal: each step with a spinner and its time, the model's actions, and the timing table at the end. It writes only to stderr, so stdout stays the JSON result. |
| `config.py` | Settings, keys, screen size, and where the profile ID is kept (`state/`, git-ignored, mode 600). |

## What we learned

- **Save the profile back after every session** (`persist_profile=True`). A session that only loads it leaves stale sign-in cookies behind, and the next session lands on the sign-in page.
- **Wait for the browser window before typing.** Keys sent while the desktop is still starting are lost, and a half-typed address can't be reached.
- **Studio's runs table doesn't show run IDs.** Its TIME column is when the run was enqueued, in the browser's time zone (New York on Steel), and DURATION is the API's `total_time_ms`.
- **Steel generates a browser fingerprint unless told not to.** Sessions here set `skip_fingerprint_injection`. Steel also records every session, and SDK 0.19 has no switch to turn that off.
- **Studio shows a new key's value once, and the next screenshot carries it to the model's vendor.** Here that's a test key revoked at the end of the run; a real workflow needs to keep secrets out of screenshots.
- **The model asks for a screenshot before it acts, even when the first message carries one.** Passing the screen as the answer to a screenshot call it already made lets it act on its first turn, which saves a turn in every step.
- **Studio's Service keys table cuts names to about a dozen characters**, so every `studio-check-…` key looks the same and the model had to hover over each row to read it, one turn per row. Searching for the exact name answers from one screenshot, however many keys there are.
- **Cap every streamed model turn.** A streamed response can stay open without ever finishing, so a read timeout never fires; one turn here ran for over 9 minutes. Each turn now gets 60 seconds, twice the longest healthy turn measured, then is tried again, up to three times.
- **The service keys API hides revoked and expired keys unless asked** (`include_revoked`, `include_expired`), and pages 20 at a time. Studio's settings page asks for both, so a revoked key still counts as existing there.
- **The live view link needs care.** Anyone holding a session's debug URL can control it, so the program shows it only in the terminal, next to Steel's own viewer link, which needs a Steel sign-in.
