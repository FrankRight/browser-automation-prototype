# Requirements: `create_secret` on a stand-in runtime

The next step for the prototype is to run a browser workflow the way AGNT5 will, from a run page that looks like Studio's. A workflow called `create_secret` opens a live browser in the page for a person to sign in. It then carries on by itself, pauses for a "yes" before it writes, and creates a project secret in Studio with a value it generated. Last, it pauses while the person copies that value.

The workflow is written against a small local stand-in for the AGNT5 runtime. It uses the same programming model, event names and resume route, so moving it onto AGNT5 later is a swap, not a rewrite.

This repository is public, so the UI can't use Studio's own component packages. The few pieces it needs (step tree, approval card, status labels) are rebuilt from the same open-source libraries Studio uses, matching its look: square corners, its fonts and its colours.

## 1. Repository layout

```
browser-prototype/
├─ apps/runner/        Python: stand-in runtime, run server, workflows (create_secret, the Studio check)
├─ apps/web/           Vite + React: runs list and run page
├─ packages/contract/  the event and API schema both apps are tested against
└─ package.json, pnpm-workspace.yaml   `pnpm dev` starts both apps; `pnpm test` runs both test suites
```

The terminal check (`studio_check.py`) keeps working from `apps/runner`.

## 2. Stand-in runtime

* **Same API as the AGNT5 Python SDK (0.13):** `@workflow`, `ctx.step(name, fn, *args)` and `ctx.wait_for_user(question, input_type=…, options=…)`. An approval answers `"approved"` or `"rejected"`, as Studio sends them.
* **A record of every run:** an append-only JSONL file per run, storing each step's result under a unique name (`look_1`, `look_2`).
* **Crash recovery:** after a resume or a restart, the workflow runs again from the top, and finished steps return their saved results without opening a browser. Only a step cut off midway runs again, which is why every write checks first.
* **Pauses hold nothing:** the run's status becomes `awaiting_user_input`, its thread ends, and the person's answer runs it again from the top.
* **One run per Steel profile at a time;** others wait their turn.
* **A guard on the run record** refuses anything containing the secret's value, a cookie or a live view link.

## 3. Run server

FastAPI and uvicorn, the two new Python dependencies.

* `POST /v1/runs` starts a run; `GET /v1/runs` and `GET /v1/runs/{id}` list runs and show one.
* `GET /v1/runs/{id}/stream` streams a run's events (server-sent events): its history first, then live.
* `POST /v1/workflows/resume/{run_id}` with `{"user_response": …}` answers a pause. That's AGNT5's resume route; the others follow its naming.
* `GET /v1/runs/{id}/secret` returns the generated value, only while the run waits for the person to copy it. It's never cached, and answers 404 otherwise.
* `GET /v1/runs/{id}/browser` returns the live view link, only while the run waits on a sign-in. It's never cached, and answers 404 otherwise.
* **Access:** it listens on localhost only and needs a token created at start, because the live view link controls a signed-in browser.

## 4. Events

* **AGNT5's own names,** so Studio could show them unchanged:
  * `run.started`, `run.paused`, `run.resumed`, `run.completed`, `run.failed`
  * `workflow.step.started`, `workflow.step.completed`, `workflow.step.failed`, `workflow.step.paused`
  * `approval.requested`
  * `progress.update`, for the model's actions
* **Four new ones,** which double as proposals for AGNT5: `browser.takeover.started` and `browser.takeover.ended`, and `secret.handover.started` and `secret.handover.ended`. None carries the link or the value.

## 5. The workflow

Input: the name (UPPER_SNAKE_CASE) and the environment: All Environments, production or staging. The runner generates the value (43 random characters) unless a run gives one.

1. `check_login`: open Secrets with the saved profile and see whether Studio is signed in.
2. **If signed out:** open an interactive browser on the sign-in page, pause with "Sign in to Studio, then continue", then close the browser to save the login. Up to 3 tries.
3. `look_1`: search for the name. If it's already there, stop with `exists`.
4. **Approval pause:** "Create secret NAME in PROJECT for ENVIRONMENTS?"
5. `create`: check again, then fill in the dialog. The model types the placeholder `{{value}}`, and the runner sends the real value in its place.
6. `read_back`: search again. If Studio doesn't list it, the run pauses for the person to check Studio.
7. **Copy pause:** the page shows the value, masked until the person shows it, with a Copy button. "I've copied it" ends the run.

The run's output is the name, the environments and the status, never the value. The saved input holds only the placeholder; the value itself stays in a private file (mode 600) until the run ends.

## 6. Web app

* **Stack:** Vite, React 19, TypeScript, Tailwind v4, Radix and lucide icons, all open source and the same as Studio's.
* **Runs list and start form:** the form asks for the name, forced to upper case, and the environment, from a select of All environments, Production and Staging. The value is generated.
* **Run page:** a status header, the step tree on the left with details on the right, and the model's actions under each step.
* **Approval card:** like Studio's amber "Awaiting your approval", with Approve and Reject.
* **Browser drawer:** opens on `browser.takeover.started`, pushing the steps aside, fetches the link only then, and keeps it out of storage and the address bar. It closes on Continue.
* **Copy card:** shown on the copy pause. It fetches the value only then, keeps it masked until the person shows it, and copies it without showing it.

## 7. Security

Each rule has a test.

* **The link and the value stay hidden:** neither appears in the run record, events, logs, page addresses or model prompts.
* **The model never sees credentials:** no screenshot goes to it while a person is using the browser.
* **The value stays masked:** the model is told never to press the value field's reveal button.
* **Test accounts only:** Steel records every session as video.

## 8. Done when

* **Unit tests** cover saved results being reused, a crash mid-step running only that step again, pauses resuming, the guard refusing secrets, and the placeholder swap.
* **UI tests use Vitest, not Playwright:** the panel opens and closes on the takeover events, and Approve sends `"approved"`.
* **End to end, on a test Studio project:**
  * From signed out, a person signs in through the panel and approves, and the secret is created once.
  * Killing the runner mid-create leaves exactly one secret after the run resumes.
  * Rejecting at the approval creates nothing.
  * No live view link or secret value appears in any log.
* **Cleanup:** test secrets are deleted afterwards.

## Prerequisites

Node 20+ and pnpm 9+ (new), plus Python 3.12, uv and the keys the prototype already uses. Steel's free plan allows 15-minute sessions, which is enough for one sign-in.

## Before building: a half-day check

* The live browser embeds in a local page and accepts typing.
* The model can work Studio's Add Secret dialog, including the environment picker, typing the placeholder for the value.
* The API can delete a secret, which cleanup needs.

## Out of scope

* The real AGNT5 runtime: moving onto it comes after this.
* Accounts for the UI itself: it runs on one machine, for one person.
* Notifications and deadlines for pauses.
