# Assessment Platform

This repository contains the local v1 assessment platform for managed AI-assisted coding sessions. It is intentionally isolated from the research assets in the parent folder.

Published repository:

- [managed-ai-assessment-platform](https://github.com/Code-Alchemist101/managed-ai-assessment-platform)

## Current Status

The project is in release-candidate territory for the local v1 goal:

- Replay-fixture regression remains intact as the baseline path.
- The control plane is the source of truth for manifests, session state, completeness, missing streams, and scoring metadata.
- The desktop + VS Code live path is working and has multiple clean local sessions.
- The full desktop + VS Code + Edge live path is implemented, build-green, integration-green, and has clean local runtime baselines for session-scoped browser bootstrap.
- The latest human-driven full-manifest session also completed end to end and scored successfully, but it landed in `review` rather than `clean` because that session visited unsupported sites and surfaced sequence-gap integrity flags.
- Reviewer and admin views support real live-session triage instead of only demo-style latest-session behavior.
- The desktop controller now includes a manifest picker, explicit browser readiness messaging, and an operator recovery action for stuck sessions.
- Provider-specific browser prompt/response capture is additive evidence only. It does not change stream-completeness rules for the full manifest.

## Core Local URLs

- Control plane: `http://127.0.0.1:4010`
- Ingestion: `http://127.0.0.1:4020`
- Ingestion event endpoint: `http://127.0.0.1:4020/api/events`
- Analytics: `http://127.0.0.1:4030`
- Reviewer: `http://127.0.0.1:4173`
- Admin: `http://127.0.0.1:4174`

## Repo Layout

- `apps/desktop-controller`: Electron managed session launcher
- `apps/reviewer-web`: reviewer console
- `apps/admin-web`: admin console
- `extensions/vscode-assessment`: VS Code live telemetry extension
- `extensions/edge-managed`: managed Edge extension
- `packages/contracts`: shared contracts and signal taxonomy
- `services/control-plane-api`: manifests, sessions, bootstrap, scoring orchestration
- `services/ingestion-api`: telemetry ingestion
- `services/analytics-py`: 51-signal extraction, integrity, HACI, archetype scoring
- `fixtures`: replay-fixture regression payloads

## Supporting Docs

- [Platform Brief](/C:/Users/hosan/Desktop/Research%20Project/assessment-platform/docs/platform-brief.md)
- [Release Status](/C:/Users/hosan/Desktop/Research%20Project/assessment-platform/docs/release-status.md)
- [Integration Blueprint](/C:/Users/hosan/Desktop/Research%20Project/assessment-platform/docs/integration-blueprint.md)
- [Demo Script](/C:/Users/hosan/Desktop/Research%20Project/assessment-platform/docs/demo-script.md)
- [AntiGravity KT Handoff](/C:/Users/hosan/Desktop/Research%20Project/assessment-platform/docs/antigravity-kt.md)
- [Operator Manual](/C:/Users/hosan/Desktop/Research%20Project/assessment-platform/docs/operator-manual.md)
- [Architecture Notes](/C:/Users/hosan/Desktop/Research%20Project/assessment-platform/docs/architecture.md)
- [Signal Catalog](/C:/Users/hosan/Desktop/Research%20Project/assessment-platform/docs/signal-catalog.md)

## Local Setup

1. `cd "C:\Users\hosan\Desktop\Research Project\assessment-platform"`
2. `npm install`
3. `python -m venv .venv`
4. `.\\.venv\\Scripts\\Activate.ps1`
5. `pip install -r services\\analytics-py\\requirements.txt`

## Build And Automated Verification

Run these before manual validation and again before final handoff:

```powershell
npm run build
npm run test:web
npm run test:integration
npm run test:analytics
```

What these cover:

- `build`: TypeScript workspaces plus web builds
- `test:web`: reviewer/admin view-models, desktop-controller helper logic, Edge bootstrap/provider helpers
- `test:integration`: replay-fixture regression, live desktop + IDE, invalid missing-IDE flow, full live browser bootstrap flow
- `test:analytics`: Python feature extraction and integrity checks

## Run The Local Stack

Build first:

```powershell
npm run build
```

Or use the one-command local stack launcher, which builds first, starts the backend/web services in one console, and then launches the desktop controller automatically:

```powershell
npm run dev:stack
```

Use the full live manifest directly from startup with:

```powershell
npm run dev:stack:full
```

If you want the stack to run in the background and manage it more like a local app, use:

```powershell
npm run dev:stack:start
npm run dev:stack:status
npm run dev:stack:stop
```

On Windows, `npm run dev:stack:start` and `npm run dev:stack:start:full` are now the least noisy startup path because they hide the helper shells used to launch the local services. You should still expect the intentional product surfaces to open during a live run:

- Electron desktop controller
- VS Code Extension Development Host
- managed Edge browser window

Start the background stack directly into the full manifest with:

```powershell
npm run dev:stack:start:full
```

Then start each service in its own PowerShell window from the repo root:

```powershell
npm run dev:analytics
npm run dev:ingestion
npm run dev:control-plane
npm run dev:reviewer
npm run dev:admin
npm run dev:desktop-controller
```

For a non-interactive startup sanity check without opening the desktop controller, use:

```powershell
npm run dev:stack:smoke
```

For automated local smoke runs, the desktop controller also supports:

- `ASSESSMENT_AUTO_START_WORKSPACE`
- `ASSESSMENT_AUTO_START_DELAY_MS`
- `ASSESSMENT_AUTO_END_WHEN_READY`
- `ASSESSMENT_AUTO_END_DELAY_MS`

These hooks are useful for managed local smoke validation when you want the controller to start a session from a known workspace and end it automatically once all required streams are present.

The local runtime data root used by the built-in service runner is:

```text
C:\Users\hosan\Desktop\Research Project\assessment-platform\.runtime-data\local-dev
```

## Desktop Controller Workflow

The desktop controller is the primary manual entry point for local live sessions.

What it now supports:

- manifest picker loaded from the control-plane manifest inventory
- default selection of `manifest-python-cli-live-desktop-ide`
- explicit browser readiness messaging for the full live manifest
- `Abandon Session` for stuck active runs
- score gating until all required non-desktop streams are present

Important notes:

- The manifest picker is the preferred manual path.
- `ASSESSMENT_MANIFEST_ID` is still supported for scripted or automation runs.
- The controller prefers native `Code.exe` on Windows when resolving VS Code.

## Manual Acceptance

Use the local live test folder when prompted unless you are validating another workspace:

```text
C:\Users\hosan\Desktop\Research Project\Test_folder
```

### Default Manifest Acceptance

1. Start the stack and open the desktop controller.
2. Leave the picker on `manifest-python-cli-live-desktop-ide`.
3. Click `Start Live Session` and choose the test folder.
4. Confirm the controller progresses through:
   - `launching`
   - `awaiting_ide_stream`
   - `ready_to_score`
5. Confirm VS Code opens automatically.
6. Make at least one edit/save in the Extension Development Host window.
7. Click `End And Score Session`.
8. Confirm reviewer/admin show:
   - `desktop + ide`
   - no missing required streams
   - integrity verdict `clean`

### Full Manifest Acceptance

1. Start the stack and open the desktop controller.
2. Use the manifest picker to select `manifest-python-cli-live-full`.
3. Click `Start Live Session` and choose the test folder.
4. Confirm VS Code opens automatically.
5. Confirm Edge opens in the managed session profile.
6. Stay on allowlisted sites if you want a clean acceptance run:
   - `chat.openai.com`
   - `claude.ai`
   - `gemini.google.com`
   - `stackoverflow.com`
   - `developer.mozilla.org`
   - `docs.python.org`
   - `www.google.com`
7. Avoid non-allowlisted browsing such as `bing.com` or `w3schools.com` during a clean acceptance pass because the policy layer can intentionally downgrade the session to `review`.
8. Confirm the controller does not allow scoring until both IDE and browser telemetry appear.
9. Confirm reviewer/admin show:
   - `desktop + ide + browser`
   - no missing required streams
   - integrity verdict `clean`
10. If the run gets stuck with a missing stream, use `Abandon Session` and start a fresh run.

### Provider Prompt/Response Sanity Check

This is a supplemental browser-evidence check on top of the full manifest acceptance.

1. During a full-manifest run, use the managed Edge window.
2. Open one supported provider page:
   - `chat.openai.com`
   - `claude.ai`
   - `gemini.google.com`
3. Sign in inside that managed session profile if required.
4. Send one prompt and wait for one visible response.
5. Confirm the active session records `browser.ai.prompt` and `browser.ai.response` without invalidating the session.

Provider capture is additive evidence only. A session can still be clean without provider prompt/response events if browser completeness and required streams are otherwise satisfied.

For VS Code:

- the strongest first-class prompt/response telemetry currently comes from the assessment extension's own `Assessment Platform: Open AI Assist` command
- third-party VS Code chat panes can still influence coding behavior, but they may not always emit first-class `ide.ai.prompt` or `ide.ai.response` events

### Recovery Acceptance

1. Start a live session and intentionally leave one required stream missing.
2. Confirm the controller explains which stream is still missing.
3. Click `Abandon Session`.
4. Confirm the session is marked invalid and a new session can be started immediately.

## Useful Checks

Health checks:

```powershell
curl.exe -s http://127.0.0.1:4030/health
curl.exe -s http://127.0.0.1:4020/health
curl.exe -s http://127.0.0.1:4010/health
```

Runtime and session inspection:

```powershell
curl.exe -s http://127.0.0.1:4010/api/runtime
curl.exe -s http://127.0.0.1:4010/api/manifests
curl.exe -s http://127.0.0.1:4010/api/sessions
curl.exe -s http://127.0.0.1:4010/api/sessions/<sessionId>
curl.exe -s http://127.0.0.1:4010/api/sessions/<sessionId>/bootstrap
curl.exe -s http://127.0.0.1:4010/api/sessions/<sessionId>/scoring
curl.exe -s http://127.0.0.1:4010/api/sessions/<sessionId>/events
npm run session:report -- <sessionId>
```

`session:report` reads the saved local runtime files and prints one operator summary with HACI, archetype, integrity flags, missing streams, source mix, unsupported browser sites, and sequence anomaly hints.

## Managed Edge Notes

- The managed Edge extension is loaded only in the isolated browser instance launched by the desktop controller.
- It is not installed into your normal everyday Edge profile.
- Each full-manifest session uses its own profile directory under:

```text
C:\Users\hosan\Desktop\Research Project\assessment-platform\.runtime-data\local-dev\browser-profiles\<sessionId>
```

- If you open your regular Edge and check extensions, you will not see the assessment extension there.

## Acceptance Baselines

Saved local runtime data currently contains these useful clean baselines:

- Default live baseline from earlier manual validation:
  - `4f80c709-ba1b-422d-ac3d-471aef6a48bf`
- Fresh default live clean baseline on the integrated build:
  - `f5455aeb-91d5-4261-a49d-b8f5c42136a2`
- Full live clean baseline validating session-scoped browser bootstrap and clean scoring:
  - `d0ad26fb-7a63-47f1-9763-9aaaf849f7be`
- Latest automated clean full-manifest baseline on the integrated build:
  - `c5ebe45c-2888-4af7-8d1c-447709e8a12c`
- Latest human-driven full-manifest session:
  - `36e6bd86-2423-49b7-9da1-9247d7f62e04`
  - status: scored
  - verdict: `review`
  - reason: `unsupported_site_visited` plus `sequence_gap_detected`

These full-manifest baselines validate the managed Edge bootstrap path and clean browser-complete scoring. Provider prompt/response capture should still be rechecked on the next signed-in manual full-manifest run.

## Known Limitations And Deferred Items

- Native Windows idle/focus hooks remain deferred for post-v1 hardening.
- The analytics pipeline processes all 51 signal slots, but some signals still rely on generic or partial live evidence until native OS hooks are added.
- Provider-specific browser capture is best-effort on supported provider pages and is intentionally limited to additive prompt/response evidence.
- Third-party VS Code AI chat panes may influence coding behavior without always producing first-class `ide.ai.prompt` or `ide.ai.response` telemetry unless the interaction flows through the assessment extension's own managed AI panel.
- One recent human-driven full-manifest session scored successfully but landed in `review` because it visited unsupported sites and surfaced browser/IDE sequence gaps. That is a real operational caveat and should be part of any honest handoff.
- Browser completeness for the full manifest remains based on the existing managed browser events, not on provider capture.
- Replay-fixture regression must remain untouched except for compatibility and regression protection.

## Final Local v1 Definition Of Done

For this repository, local v1 is considered done when all of the following are true:

- `npm run build`
- `npm run test:web`
- `npm run test:integration`
- `npm run test:analytics`
- default manifest manually validated clean on the latest build
- full manifest manually validated clean on the latest build
- reviewer/admin usable for successful and failed live-session triage
- the repo documentation is sufficient for another operator to run and validate the system locally
