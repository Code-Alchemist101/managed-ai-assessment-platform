# AntiGravity KT Handoff

## Purpose

This document is the current handoff note for anyone taking over the local assessment platform repository after the April 2026 implementation and hardening passes.

It is written as a software KT document rather than a pitch deck. The goal is to make another engineer productive quickly.

For the latest operational snapshot, see [Release Status](/C:/Users/hosan/Desktop/Research%20Project/assessment-platform/docs/release-status.md).

For recommended model selection while using AntiGravity or similar agentic tools, see [AGENTS.md](/C:/Users/hosan/Desktop/Research%20Project/assessment-platform/AGENTS.md).

## Workspace And Environment

- Primary repo:
  - `C:\Users\hosan\Desktop\Research Project\assessment-platform`
- GitHub repo:
  - `https://github.com/Code-Alchemist101/managed-ai-assessment-platform`
- Manual test workspace used during live runs:
  - `C:\Users\hosan\Desktop\Research Project\Test_folder`
- Operating system:
  - Windows
- Shell used during implementation:
  - PowerShell
- Local runtime data root:
  - `C:\Users\hosan\Desktop\Research Project\assessment-platform\.runtime-data\local-dev`

## What Was Built

### Visible operator-facing products

1. Electron desktop controller
   - Starts and manages local live assessment sessions.
   - Lets the operator choose a manifest.
   - Shows readiness, missing streams, and scoring state.
   - Can abandon a stuck session.

2. VS Code assessment extension
   - Runs inside the Extension Development Host.
   - Emits IDE telemetry for the active session.
   - Persists sequence numbering across extension reactivation for integrity stability.

3. Managed Edge extension
   - Binds to the exact session by session-scoped bootstrap.
   - Emits browser completeness events.
   - Adds provider prompt/response capture as supplemental evidence on supported domains.

4. Reviewer web app
   - Shows scored and invalid sessions.
   - Displays completeness, source mix, integrity verdicts, and triage details.

5. Admin web app
   - Shows manifests and recent session inventory.
   - Provides operational visibility into session status and reviewer links.

### Back-end and shared platform pieces

1. Control-plane API
   - Source of truth for manifests, session detail, completeness, bootstrap, and scoring metadata.

2. Ingestion API
   - Accepts telemetry events at `POST /api/events`.

3. Analytics Python service
   - Builds the 51-signal vector.
   - Computes integrity outputs, HACI score, and archetype prediction.

4. Shared contracts package
   - Keeps session, scoring, and bootstrap shapes aligned across the stack.

5. Replay-fixture baseline
   - Preserved as the regression path.
   - Must not be redesigned as part of local-live hardening.

6. Local stack manager tooling
   - One-command foreground stack startup.
   - Background start, status, and stop flow for Windows-friendly local use.

## Stack Summary

- Frontend / desktop:
  - Electron
  - TypeScript
  - Vite for web apps
- IDE telemetry:
  - VS Code extension API
  - TypeScript
- Browser telemetry:
  - Edge extension
  - TypeScript
- Shared contracts:
  - TypeScript
- Control-plane and ingestion services:
  - Node.js
  - TypeScript
- Analytics:
  - Python
  - FastAPI / Uvicorn
- Tests:
  - `tsx --test` for TypeScript suites
  - `unittest` for Python analytics

## Repo Layout

- `apps/desktop-controller`
  - Electron operator app for managed live sessions
- `apps/reviewer-web`
  - reviewer triage UI
- `apps/admin-web`
  - admin/operations UI
- `extensions/vscode-assessment`
  - IDE telemetry extension
- `extensions/edge-managed`
  - managed Edge extension
- `packages/contracts`
  - shared session, bootstrap, scoring, and signal contracts
- `services/control-plane-api`
  - session orchestration and session detail APIs
- `services/ingestion-api`
  - event intake
- `services/analytics-py`
  - feature extraction and scoring
- `fixtures`
  - replay-fixture regression payloads
- `tests`
  - web and integration coverage
- `scripts`
  - local startup, demo, and stack management helpers

## Architecture Decisions That Must Stay Intact

1. Replay-fixture remains intact as a regression baseline.
2. Desktop + IDE is the stable local live baseline.
3. Browser capture is added only through session-scoped bootstrap.
4. Browser capture must not rely on `latest_session_id`.
5. The default local live smoke manifest remains:
   - `manifest-python-cli-live-desktop-ide`
6. The full manifest for browser-complete sessions is:
   - `manifest-python-cli-live-full`
7. The control plane is the source of truth for:
   - session state
   - completeness
   - missing streams
   - bootstrap context
   - scoring metadata
8. Provider-specific browser capture is additive evidence only.
9. Native Windows idle/focus hooks are deferred and are not a local v1 blocker.

## Major Implementation Outcomes

### Contracts

- Added richer shared contracts for:
  - policy recommendation
  - event counts by source
  - session detail
  - browser session bootstrap

### Control plane

- Added richer `GET /api/sessions`
- Added richer `GET /api/sessions/:sessionId`
- Added `GET /api/sessions/:sessionId/bootstrap`
- Added `GET /browser-bootstrap?sessionId=...`
- Added the full live manifest

### Desktop controller

- Normalizes ingestion URLs to `/api/events`
- Polls authoritative session detail from the control plane
- Enforces readiness gating based on required streams
- Prevents optimistic scoring when IDE or browser data is missing
- Uses native `Code.exe` preference on Windows
- Uses `--new-window` for VS Code launch
- Launches managed Edge with a per-session profile
- Supports manifest picker, browser readiness messaging, and abandon/reset
- Supports automation hooks for local smoke runs

### Edge extension

- Recovers or fetches exact bootstrap context for a specific session
- Emits session-bound browser events
- Does not use `latest_session_id`
- Emits:
  - `browser.navigation`
  - `browser.tab.activated`
  - provider prompt/response evidence on supported domains

### Reviewer/admin

- Both UIs now support real live-session triage rather than only demo-style snapshots
- Invalid sessions are visible
- Missing streams and completeness state are visible

### Local operator tooling

- One-command stack startup:
  - `npm run dev:stack`
  - `npm run dev:stack:full`
- Background stack lifecycle:
  - `npm run dev:stack:start`
  - `npm run dev:stack:start:full`
  - `npm run dev:stack:status`
  - `npm run dev:stack:stop`
- Windows shell noise was reduced by hiding helper launch windows in the local scripts where possible

## Chronological Summary Of Important Fixes

1. Fixed desktop ingestion target to use `POST /api/events` instead of `POST /`
2. Fixed Windows VS Code launch behavior by preferring `Code.exe` and `--new-window`
3. Hardened desktop readiness so missing IDE sessions do not get scored optimistically
4. Added control-plane-authoritative session detail and bootstrap
5. Added managed Edge bootstrap with per-session profile directories
6. Added reviewer/admin support for invalid or incomplete live sessions
7. Added manifest picker, browser readiness messaging, and session recovery controls
8. Added provider prompt/response forwarding as browser evidence
9. Added foreground and background stack startup helpers
10. Added controller automation hooks for auto-start and auto-end local smoke runs
11. Fixed VS Code session sequence persistence across extension reactivation
12. Added immediate heartbeat emission so short clean sessions are not downgraded for heartbeat absence

## Commands Used Regularly

### Build and test

```powershell
npm run build
npm run test:web
npm run test:integration
npm run test:analytics
```

### Foreground stack startup

```powershell
npm run dev:stack
npm run dev:stack:full
npm run dev:stack:smoke
```

### Background stack startup

```powershell
npm run dev:stack:start
npm run dev:stack:start:full
npm run dev:stack:status
npm run dev:stack:stop
```

### Individual services

```powershell
npm run dev:analytics
npm run dev:ingestion
npm run dev:control-plane
npm run dev:reviewer
npm run dev:admin
npm run dev:desktop-controller
```

## Local Service URLs

- Control plane:
  - `http://127.0.0.1:4010`
- Ingestion:
  - `http://127.0.0.1:4020`
- Analytics:
  - `http://127.0.0.1:4030`
- Reviewer:
  - `http://127.0.0.1:4173`
- Admin:
  - `http://127.0.0.1:4174`

## Environment Variables Worth Knowing

- `ASSESSMENT_MANIFEST_ID`
  - override manifest selection for scripted runs
- `ASSESSMENT_AUTO_START_WORKSPACE`
  - start a session automatically using a known workspace
- `ASSESSMENT_AUTO_START_DELAY_MS`
  - delay before auto-start
- `ASSESSMENT_AUTO_END_WHEN_READY`
  - automatically end and score once all required streams are present
- `ASSESSMENT_AUTO_END_DELAY_MS`
  - delay before auto-end

## Latest Validation Evidence

### Clean default manifest sessions

- Historical manual default clean baseline:
  - `4f80c709-ba1b-422d-ac3d-471aef6a48bf`
- Fresh integrated-build default clean baseline:
  - `f5455aeb-91d5-4261-a49d-b8f5c42136a2`

### Clean full-manifest sessions

- Earlier clean full baseline:
  - `d0ad26fb-7a63-47f1-9763-9aaaf849f7be`
- Latest automated clean full baseline on the integrated build:
  - `c5ebe45c-2888-4af7-8d1c-447709e8a12c`

### Latest human-driven full-manifest session

- Session:
  - `36e6bd86-2423-49b7-9da1-9247d7f62e04`
- Outcome:
  - scored successfully
  - HACI `47.6`
  - archetype `Independent Solver`
  - verdict `review`
- Why:
  - `unsupported_site_visited`
  - `sequence_gap_detected`
- Observed unsupported browsing in that run included:
  - `www.bing.com`
  - `www.w3schools.com`

## What Another Engineer Should Know About The UX

During a real full-manifest run, it is normal to see these product surfaces open:

- Electron desktop controller
- VS Code Extension Development Host
- managed Edge window

During earlier smoke automation, extra command windows also appeared because local service launchers were spawning helper shells on Windows. The local scripts now hide those helper shells where possible, but the visible product surfaces above are intentional and expected.

Also note:

- The managed Edge profile may show Microsoft profile sync prompts or developer-mode extension warnings.
- Those prompts do not mean the session binding is wrong.
- The extension is intentionally loaded only in the managed session profile, not in the user’s normal Edge profile.
- A successful score does not automatically mean a clean session. The latest human-driven full-manifest run is the clearest current example of a scored session that still routed to human review.

## Known Remaining Manual Step

The core local-live product is green on the latest build, but two focused follow-ups still matter:

- Signed-in provider sanity check in the managed Edge window
- Goal:
  - verify `browser.ai.prompt` and `browser.ai.response` are emitted for one supported provider page on the same live session
- Manual-session sequence-gap investigation
- Goal:
  - explain or eliminate the `sequence_gap_detected` path seen in session `36e6bd86-2423-49b7-9da1-9247d7f62e04`

Why this is still manual:

- it requires a real signed-in provider interaction
- it depends on the managed Edge session profile
- it should be observed as an end-to-end operator flow, not only as a unit test

## Recommended Next Actions For AntiGravity

1. Run:
   - `npm run build`
   - `npm run test:web`
   - `npm run test:integration`
   - `npm run test:analytics`
2. Start the background full stack with:
   - `npm run dev:stack:start:full`
3. Use:
   - `npm run session:report -- 36e6bd86-2423-49b7-9da1-9247d7f62e04`
   - `npm run session:report:latest`
   - `npm run session:report:latest:json`
   to get a one-command explanation of the latest human-driven reviewed session before opening raw NDJSON by hand
4. Perform one signed-in provider sanity check in managed Edge on an allowlisted provider page
5. Reproduce the `sequence_gap_detected` review path with a narrow manual run and decide whether it is a telemetry defect or an acceptable policy downgrade
6. If those items are understood, freeze local v1 and move to packaging, demo, or hosted pilot planning
7. Treat native Windows idle/focus hooks as post-v1 hardening, not as a blocker
