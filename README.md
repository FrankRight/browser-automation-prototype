# Browser automation prototype

Workflows that use a website through its screens, in a full, visible browser on [Steel](https://steel.dev). Steel's Input API sends the mouse and keyboard actions, and an OpenAI computer-use model reads the screen and decides them. No browser-automation library is involved.

It has two parts:

- **A run page for `create_secret`.** A workflow that adds a project secret in [AGNT5](https://agnt5.com) Studio through Studio's own pages. If Studio is signed out, the page opens a live browser for you to sign in. The run then carries on by itself, and pauses for your approval before it creates the secret. It runs on a small local stand-in for the AGNT5 runtime, written the way the workflow will be on AGNT5. [docs/requirements.md](docs/requirements.md) has the details.
- **The Studio check**, a terminal program. It reads a project's 20 newest finished runs from Studio, has an agent check them against the AGNT5 API, and, if they all match, creates a service key once, after you approve it.

## Layout

| Path | What's there |
|---|---|
| `apps/runner` | Python: the stand-in runtime (`runtime/`), the run server (`server.py`), the workflows (`workflows/`), the browser steps, and the Studio check |
| `apps/web` | The run page: Vite, React, TypeScript and Tailwind, in Studio's look |
| `packages/contract` | The run events and the run's shape that both apps follow, with AGNT5's event names |
| `docs/requirements.md` | What the run page and the stand-in runtime must do |

## Set up

You need Python 3.12 with [uv](https://docs.astral.sh/uv/), and Node 20+ with pnpm 9+.

```bash
pnpm install
cd apps/runner
uv sync
cat > .env.local <<'EOF'
STUDIO_URL=https://app.agnt5.com
STUDIO_PROJECT_ID=<the project to work in>
STUDIO_API_URL=https://api.agnt5.com
STUDIO_API_KEY_FILE=<a file holding an AGNT5 API key for the project>
OPENAI_ENV_FILE=<a dotenv file that sets OPENAI_API_KEY>
EOF
chmod 600 .env.local
```

`.env.local` is git-ignored, and environment variables override it. Put the Steel key in `~/.steel-key` (mode 600), or set `STEEL_API_KEY`. You can also set `OPENAI_API_KEY` directly instead of `OPENAI_ENV_FILE`. Keys are read inside the programs and never printed.

## Run the page

```bash
pnpm dev     # the runner and the page, reloading as you edit
pnpm start   # or build the page once and have the runner serve it, on one port
```

The runner prints an address ending in `#token=…`. Open it once in your browser. On a remote machine, forward port 5173 for `pnpm dev`, or 8790 for `pnpm start`. The page signs in with the token and drops it from the address. The runner listens on localhost only, and every request needs that sign-in, because the page can hand out the live view link of a signed-in browser.

Press **Run create_secret**, enter the secret's name, value and environments, and follow the run:

1. **Sign in, if needed.** If Studio is signed out, a live browser slides open beside the steps, pushing them aside. Sign in there, then press **Continue**, and it slides shut. The model doesn't see the screen while you use it.
2. **Behind the scenes.** The run looks for the secret, showing each step's progress and the model's actions.
3. **Approve.** It pauses until you choose **Create secret** or **Don't create**.
4. **Done.** It adds the secret through Studio's dialog, checks that Studio lists it, and finishes.

The value never reaches the model or the run's records. The model types the placeholder `{{value}}` into Studio's masked value field, and the browser types the real value in its place. The run records the placeholder, and the value waits in a private file (mode 600) until the run ends.

To try the sign-in, sign the saved profile out of Studio first: `cd apps/runner && uv run python sign_out.py`.

Runs survive a restart. Stop the runner mid-run and start it again, and the run carries on from its record. Finished steps don't run again, and the write looks before it acts, so a secret is never added twice.

To run a second runner alongside, such as for a test, give it its own port and its own run records: `RUNNER_PORT=8791 RUNNER_STATE_DIR=/tmp/runner-state uv run python server.py`, with a copy of `state/profile.json` in that folder. Without its own records, a second runner would pick up the first one's runs.

## The stand-in runtime

`apps/runner/runtime` runs workflows the way AGNT5 does, on one machine. A workflow is an async function in the AGNT5 SDK's shape:

```python
@workflow("create_secret", secret_inputs=("value",))
async def create_secret(ctx, name: str, environments: list[str], value: str):
    look = await ctx.step("look_1", look_for_secret, profile, name)
    decision = await ctx.wait_for_user("Create the secret?", input_type="approval")
```

- **`ctx.step(name, fn, *args)`** runs `fn` once and records its result. After a pause or a restart, the workflow runs again from the top, and finished steps return their recorded results without running.
- **`ctx.wait_for_user(...)`** pauses the run until a person answers. An approval answers `"approved"` or `"rejected"`, as Studio's card does.
- **`ctx.take_over_browser(session_id, question)`** is the one addition to the SDK's shape: a pause while a person uses a live browser.
- **Events use AGNT5's names** (`workflow.step.started`, `approval.requested`, `run.paused` and so on), and the resume route is AGNT5's own: `POST /v1/workflows/resume/{run_id}`.
- **Each run's events are kept in `apps/runner/state/runs/<id>/events.jsonl`** (git-ignored). Before writing an event, the runtime checks that it holds no secret input, live view link or cookie, and fails the run rather than record one.

## Run the Studio check

From `apps/runner`:

```bash
uv run python studio_check.py
```

It prints a JSON report:
- how many of the 20 newest finished runs were checked and matched the API;
- every `mismatch`, field by field, with both values;
- runs `not_in_api`;
- `misreads`.

When the agent finds a disagreement, the program reads Studio again and re-checks those runs. A disagreement the second read doesn't repeat was the first read getting the screen wrong, so it's listed as a misread rather than a mismatch.

When there's no saved sign-in yet, or it has expired, the program pauses. It opens Studio's sign-in page in a Steel session, shows you the session's links in the terminal, and waits for you to sign in there and type `done`. After three `done` answers that leave Studio signed out, it stops with `{"status": "login_failed"}`. Other results are `unrecognised` when it can't find the runs table, and `unavailable` when the model or Steel doesn't answer in time.

When every run matches, it asks you to approve creating a service key with an exact, one-off name (`studio-check-<date>-<4 hex>`). Type `yes` to create it; anything else creates nothing.
- **It looks before it acts:** if Studio already lists a key with that name, it doesn't create another.
- **A crash doesn't lose the approval:** the approved name is kept in `state/` until the write finishes, so the next run resumes it without asking again.
- **Leftover sessions are closed:** each run releases any Steel session a crashed run left holding the profile. It can't tell those from another run's sessions, so run one check at a time.
- **If it can't tell whether Studio created the key,** it asks you to check Studio and type `created` or `not created`.
- **The key is revoked at the end;** it only exists to test the write.

While it runs, the terminal shows what it's doing:
- each step, with a spinner and the time it has taken;
- the model's clicks, typing and scrolling as they happen;
- a link to watch each browser session on Steel.

It ends with a table of where the time went. Typed text is shown only when it's the approved key name. Nothing the model writes is shown, because it could repeat something private from the screen. Without a terminal (in a pipe or a log), the same information comes as timestamped lines. `--quiet` leaves the progress out.

### The demo, in the terminal

From `apps/runner`:

1. **A normal run.** Run `uv run python studio_check.py`, then type `yes` at the approval. It reads the runs, checks them against the API, creates the key once and revokes it, then sums up in two lines. It takes about a minute and a half.
2. **The login pause.** Run `uv run python sign_out.py`, then `uv run python studio_check.py`. Open the Steel dashboard link it prints, sign in to Studio there, and type `done`. The run carries on without a restart. (`--show-live-view-link` also prints the session's live view link, which works for anyone who has it.)
3. **A crash, and recovery.** Run `uv run python studio_check.py --crash-after-create`, then type `yes`: it dies right after Studio creates the key, as `kill -9` would. Then run `uv run python studio_check.py` again. It releases the session the crash left, resumes the approved write without asking again, finds the key instead of creating a second one, and revokes it.

To watch the browser while it works, open the "Watch it on Steel" link the terminal prints when each session starts (it needs a Steel sign-in). Don't show it on a shared screen while the key's dialog is open: Studio shows the new key's value there once.

## Tests

`pnpm test` runs the page's tests (Vitest) and the runner's (pytest). They cover replay, pauses, crash recovery, the record's guard, secret inputs, the server's routes, the event contract, the approval card and the browser panel. Neither touches Steel or the model.

## How it works

Every file below is in `apps/runner`.

| File | What it does |
|---|---|
| `runtime/` | The stand-in for the AGNT5 runtime: the workflow API (`context.py`), the engine that runs, pauses and resumes runs (`engine.py`), and each run's guarded record (`journal.py`). |
| `server.py` | The run server: starts runs, streams their events, takes answers, and hands the page a live view link only while a run waits for someone in the browser. |
| `workflows/create_secret.py` | The `create_secret` workflow. |
| `studio_secrets.py` | Studio's Secrets page through the browser: look for a secret by searching for its name, and add one, looking first. |
| `steel_session.py` | Opens one Steel session per action and always releases it. Sessions are headful, with no generated fingerprint, CAPTCHA solving, proxies or simulated mouse movement. |
| `computer_use.py` | The loop between the model and the screen. It stops on a safety check instead of approving it, keeps screenshots in memory, and types secret values in place of their placeholders. |
| `studio_check.py` | The terminal program: reads the runs, pausing for a person whenever Studio needs a login, then checks them against the API. |
| `compare.py` | The comparison step: an agent looks each run up with a `get_run_summary` tool and reports disagreements in a fixed JSON shape. It never touches the browser, and it treats what it was shown as data. |
| `create_key.py` | The service key write: looks for a key with the approved name, creates it through Studio's dialog if there's none, and reads the list back. Only the model's JSON answer is read, so a key's value shown on screen can't come back through its text. |
| `agnt5_api.py` | The AGNT5 API calls: reading runs, and finding and revoking service keys. |
| `api_runs.py` | The comparison tool's lookup: the project's runs from the AGNT5 API, keyed by enqueue time as Studio shows it. |
| `read_runs.py` | The read step: opens the Runs page, has the model read 20 finished runs, and returns them as plain data, `needs_login` or `unrecognised`. |
| `login_window.py` | Opens Studio's sign-in page in a Steel session for a person, and releases it afterwards, which saves the login to the profile. |
| `sign_out.py` | Test helper: signs the saved profile out of Studio. |
| `progress.py` | Live progress: on the terminal for the Studio check, and as `progress.update` events for runs on the page. |
| `config.py` | Settings, keys, screen size, and where the profile ID is kept (`state/`, git-ignored, mode 600). |

## What we learned

- **Save the profile back after every session** (`persist_profile=True`). A session that only loads the profile leaves stale sign-in cookies behind, and the next session lands on the sign-in page.
- **Wait for the browser window before typing.** Keys sent while the desktop is still starting are lost, and a half-typed address can't be reached.
- **Studio's runs table doesn't show run IDs.** Its TIME column is when the run was enqueued, in the browser's time zone (New York on Steel), and DURATION is the API's `total_time_ms`.
- **Steel generates a browser fingerprint unless told not to.** Sessions here set `skip_fingerprint_injection`. Steel also records every session, and SDK 0.19 has no switch to turn that off.
- **Studio shows a new key's value once, and the next screenshot carries it to the model's vendor.** Here that's a test key, revoked at the end of the run. A real workflow needs to keep secrets out of screenshots.
- **The model can enter a secret it never sees.** It types a placeholder into a masked field, and the browser layer types the value in its place. In 5 of 5 checks, Studio stored exactly the value.
- **The model asks for a screenshot before it acts, even when the first message carries one.** Passing the screen as the answer to a screenshot call it already made lets it act on its first turn, which saves a turn in every step.
- **Studio's Service keys table cuts names to about a dozen characters.** Every `studio-check-…` key looks the same, so the model had to hover over each row to read it, one turn per row. Searching for the exact name answers from one screenshot, however many keys there are.
- **Cap every streamed model turn.** A streamed response can stay open without ever finishing, so a read timeout never fires; one turn here ran for over 9 minutes. Each turn now gets 60 seconds, twice the longest healthy turn measured, and is then tried again, up to three times.
- **The service keys API hides revoked and expired keys unless asked** (`include_revoked`, `include_expired`), and pages 20 at a time. Studio's settings page asks for both, so a revoked key still counts as existing there.
- **The live view link needs care.** Anyone holding a session's debug URL can control the session. The terminal check shows it only with `--show-live-view-link`. The run page asks the runner for it only while a run waits on you in the browser, and keeps it out of storage, the address bar and the run's records.
