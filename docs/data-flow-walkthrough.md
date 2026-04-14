# Data Flow Walkthrough

## Purpose

This document explains what happens technically during a real local live session.

It is not a user manual. It is a data-flow walkthrough for engineers who want to understand:

- what launches when a session starts
- which events are emitted during candidate actions
- where those events are stored
- how the 51-signal pipeline is used
- what happens when `End And Score Session` is clicked

## Example Scenario

Assume a candidate is taking a full managed session with:

- manifest:
  - `manifest-python-cli-live-full`
- workspace:
  - `C:\Users\hosan\Desktop\Research Project\Test_folder`

The candidate does this:

1. Starts the desktop controller
2. Chooses the full manifest
3. Selects the test folder
4. Codes in the managed VS Code window
5. Uses the extension's built-in managed AI panel
6. Opens Python documentation in the managed Edge window
7. Optionally uses an allowed AI site in the managed Edge window
8. Clicks `End And Score Session`

This walkthrough explains what happens underneath.

## Components Involved

### Visible products

- Electron desktop controller
- VS Code Extension Development Host
- managed Edge browser window
- reviewer web app
- admin web app

### Back-end services

- control plane:
  - `http://127.0.0.1:4010`
- ingestion:
  - `http://127.0.0.1:4020`
- analytics:
  - `http://127.0.0.1:4030`

## Step 1: Stack Startup

When the operator runs:

```powershell
npm run dev:stack:start:full
```

the local stack manager starts:

- analytics service
- ingestion API
- control-plane API
- reviewer web app
- admin web app
- desktop controller

The background stack manager stores runtime state and logs under:

- `C:\Users\hosan\Desktop\Research Project\assessment-platform\.runtime-data\local-dev`

## Step 2: Candidate Starts A Session

When the candidate clicks `Start Live Session` in the desktop controller and selects a folder, the desktop controller does all of the following:

1. Creates a session through the control plane:

```text
POST /api/sessions
```

Payload includes:

- `manifest_id`
- `candidate_id`

2. Marks the session active:

```text
POST /api/sessions/<sessionId>/status
```

with:

- `status = active`

3. Starts emitting desktop-scoped events to ingestion:

```text
POST http://127.0.0.1:4020/api/events
```

Typical desktop events at the beginning of the session:

- `desktop.workspace.selected`
- `desktop.vscode.launch.requested`
- `desktop.vscode.launched`
- `desktop.browser.launch.requested`
- `desktop.browser.launched`
- `session.heartbeat`

These are session-bound events. Each event contains fields such as:

- `session_id`
- `timestamp_utc`
- `source`
- `event_type`
- `sequence_no`
- `artifact_ref`
- `payload`

## Step 3: VS Code Launch And IDE Telemetry

The desktop controller launches VS Code as an Extension Development Host and points it at:

- `C:\Users\hosan\Desktop\Research Project\assessment-platform\extensions\vscode-assessment`

This is a dev-loaded extension, not a normal globally installed VS Code extension.

Once the extension activates, it begins emitting IDE telemetry such as:

- `ide.extension.activated`
- `ide.editor.focused`
- `ide.selection.changed`
- `ide.document.changed`
- `ide.document.saved`
- `ide.diagnostics.changed`
- `ide.task.started`
- `ide.debug.started`
- `ide.clipboard.copy`
- `ide.clipboard.paste`

### Example

If the candidate creates `hello.py`, types code, runs it, and saves it, the raw event stream may contain:

- `ide.document.changed`
- `ide.document.saved`
- `ide.diagnostics.changed`
- `ide.task.started`

Those IDE events are enough to establish the `ide` stream as present.

## Step 4: Built-In VS Code AI Example

For this walkthrough, assume the candidate uses the extension's own built-in AI panel by running:

- `Assessment Platform: Open AI Assist`

This is important because the extension currently captures managed VS Code AI prompt/response telemetry through its own panel.

When the candidate submits a prompt in that panel, the extension emits:

- `ide.ai.prompt`
- `ide.ai.response`

Typical payload fields include:

- `provider`
- `prompt_id`
- `prompt_text`
- `prompt_length`
- `response_id`
- `response_text`

### Important nuance

If the candidate uses some other third-party AI chat pane inside VS Code, the code-editing behavior is still captured, but the exact prompt text may not be captured as a first-class `ide.ai.prompt` event unless it flows through the assessment extension's own managed AI surface.

## Step 5: Managed Edge Launch And Browser Telemetry

For the full manifest, the desktop controller launches Edge with:

- a session-specific profile directory
- the managed unpacked Edge extension
- the session bootstrap URL

The session bootstrap page looks like:

```text
http://127.0.0.1:4010/browser-bootstrap?sessionId=<sessionId>
```

That page does two things:

1. makes the session binding visible to the operator
2. lets the managed Edge extension recover the exact session context

The Edge extension then fetches:

```text
GET /api/sessions/<sessionId>/bootstrap
```

That bootstrap payload contains:

- `session_id`
- `manifest_id`
- `control_plane_url`
- `ingestion_event_endpoint`
- `reviewer_url`
- `allowed_ai_providers`
- `allowed_sites`
- `required_streams`

### Browser events emitted automatically

- `browser.navigation`
- `browser.tab.activated`

### Example

If the candidate opens `docs.python.org`, the browser extension emits a `browser.navigation` event with fields like:

- `url`
- `domain`
- `allowed_site`
- `managed_bootstrap`

If the candidate then switches tabs, the extension emits:

- `browser.tab.activated`

## Step 6: Browser AI Prompt/Response Example

If the candidate uses an allowed provider page in the managed Edge session, such as:

- `chat.openai.com`
- `claude.ai`
- `gemini.google.com`

then the managed browser extension can emit:

- `browser.ai.prompt`
- `browser.ai.response`

Typical fields include:

- `provider`
- `page_url`
- `domain`
- `prompt_id` or `response_id`
- `prompt_text` or `response_text`
- `prompt_length` or `response_length`
- `captured_via = content_script`

These browser AI events are additive evidence on top of browser completeness.

## Step 7: Where The Raw Events Are Stored

All emitted events are posted to ingestion at:

- `POST http://127.0.0.1:4020/api/events`

The ingestion API appends them into a per-session NDJSON file:

- `C:\Users\hosan\Desktop\Research Project\assessment-platform\.runtime-data\local-dev\ingestion\sessions\<sessionId>.ndjson`

That file is the raw local event log for the session.

Each line is one JSON event.

## Step 8: What The Control Plane Stores Separately

The control plane stores:

### Session inventory

- `C:\Users\hosan\Desktop\Research Project\assessment-platform\.runtime-data\local-dev\control-plane\sessions.json`

This tracks:

- session IDs
- manifest IDs
- candidate IDs
- status
- timestamps
- whether scoring exists

### Scoring output

- `C:\Users\hosan\Desktop\Research Project\assessment-platform\.runtime-data\local-dev\control-plane\scorings\<sessionId>.json`

This stores the final scored payload returned by analytics.

## Step 9: How The Desktop Controller Knows When Scoring Is Allowed

The desktop controller polls:

```text
GET /api/sessions/<sessionId>
```

The control plane builds this session detail response by:

1. reading the session NDJSON event file
2. counting events by source
3. deriving:
   - `present_streams`
   - `missing_streams`
   - `first_event_at`
   - `last_event_at`
4. attaching scoring data if it exists

For the full manifest, scoring remains locked until required non-desktop streams are present.

That means the desktop controller waits until at least:

- `ide`
- `browser`

have both appeared in ingested events.

## Step 10: What `Send Heartbeat` Actually Does

The desktop controller already runs a heartbeat loop in the background during an active session.

It emits:

- `session.heartbeat`

on a timed loop, and also sends an initial heartbeat early in the session.

The manual `Send Heartbeat` button is just a manual trigger for the same event. It usually does not change the UI dramatically unless the session was missing heartbeat evidence.

## Step 11: What Happens When The Candidate Clicks `End And Score Session`

When `End And Score Session` is clicked, the desktop controller does all of the following:

1. Stops the heartbeat loop
2. Stops the session poll loop
3. Marks the session submitted:

```text
POST /api/sessions/<sessionId>/status
```

with:

- `status = submitted`

4. Calls:

```text
POST /api/sessions/<sessionId>/score
```

That call goes to the control plane.

## Step 12: What The Control Plane Does During Scoring

When the control plane receives:

```text
POST /api/sessions/<sessionId>/score
```

it:

1. loads the session record
2. loads the manifest
3. reads the raw event NDJSON for that session
4. sends the event list plus session context to analytics:

```text
POST http://127.0.0.1:4030/score-session
```

The session context includes things like:

- `required_streams`
- `allowed_sites`
- `allowed_ai_providers`

## Step 13: What The Analytics Service Does

Analytics does not just assign a score directly from a few rules.

It follows this pipeline:

1. extract the feature vector
2. evaluate integrity
3. compute HACI
4. compute archetype probabilities
5. return a full scoring payload

### 13.1 Feature extraction

The analytics extractor reads the event list and calculates signal values from the session behavior.

Examples:

- insert counts
- paste counts
- typing speed
- edit distance
- prompt counts
- prompt refinement
- prompt-to-code latency
- time-to-first-AI-prompt
- session duration
- focus and idle derived signals

### 13.2 The 51-signal method

Yes, the system really uses the signal catalog.

The signal catalog is stored in:

- `packages/contracts/src/signal-catalog.json`

The extractor loads the catalog, computes signal values, and produces:

- `signal_values`
- `signals`
- `completeness`
- `invalidation_reasons`

Each signal also includes provenance and completeness metadata.

### 13.3 Integrity

Analytics then evaluates integrity rules such as:

- missing required streams
- heartbeat missing
- unsupported provider use
- unsupported browser domain usage
- sequence gaps
- tamper or unmanaged tool indicators

Integrity outputs one of:

- `clean`
- `review`
- `invalid`

### 13.4 HACI and archetype

After feature extraction and integrity evaluation, analytics computes:

- HACI score
- top feature drivers
- predicted archetype
- archetype probabilities
- policy recommendation

### Important modeling note

The current archetype engine is a bootstrap heuristic model built on the extracted signal values.

It behaves like a model-driven classifier, but it is not yet a fully trained production ML model in the conventional sense.

## Step 14: What Gets Written After Scoring

After analytics returns the scoring payload, the control plane:

1. updates the session record in `sessions.json`
2. persists the scoring JSON to:
   - `control-plane/scorings/<sessionId>.json`
3. sets session status to:
   - `scored`
   - or `invalid` when integrity says invalid

The desktop controller then shows:

- final HACI
- predicted archetype
- session completion state

The reviewer can now show:

- score
- archetype
- integrity verdict
- top feature drivers
- event counts by source
- completeness and missing streams

## Step 15: Example Event Timeline For This Scenario

This is a simplified example of the kinds of events that may appear for one successful full-manifest session:

### Desktop

- `desktop.workspace.selected`
- `desktop.vscode.launch.requested`
- `desktop.vscode.launched`
- `desktop.browser.launch.requested`
- `desktop.browser.launched`
- `session.heartbeat`

### IDE

- `ide.extension.activated`
- `ide.editor.focused`
- `ide.document.changed`
- `ide.document.saved`
- `ide.diagnostics.changed`
- `ide.task.started`
- `ide.ai.prompt`
- `ide.ai.response`

### Browser

- `browser.navigation`
- `browser.tab.activated`
- `browser.ai.prompt`
- `browser.ai.response`

Those raw events are what ultimately drive:

- stream completeness
- integrity flags
- the 51-signal feature vector
- HACI
- archetype prediction

## Step 16: What This Means In Practice

If a candidate:

- writes code manually
- saves and reruns
- uses the managed VS Code AI panel
- browses allowed docs
- optionally uses an allowed managed AI site

then the platform does not only look at the final code.

It records:

- how the session was launched
- what streams were present
- how editing unfolded over time
- whether AI prompts were used
- how soon AI was used
- whether browser activity stayed within allowed sites
- whether the session had enough evidence to be scored confidently

That evidence is then transformed into the scoring payload seen by reviewer and admin.

## Practical Inspection Commands

If you want to inspect one real session locally:

```powershell
curl.exe -s http://127.0.0.1:4010/api/sessions/<sessionId>
curl.exe -s http://127.0.0.1:4010/api/sessions/<sessionId>/events
curl.exe -s http://127.0.0.1:4010/api/sessions/<sessionId>/scoring
```

Those three endpoints let you see:

1. the current authoritative session detail
2. the raw stored event stream
3. the final scored output

## Final Clarification

The current local v1 stack absolutely does use the 51-signal pipeline.

The subtle limitation is not whether scoring uses the 51 signals. It does.

The subtle limitation is whether every possible user action produces the richest possible raw telemetry. For example:

- regular coding activity is captured well
- managed browser activity is captured well
- managed browser AI prompt/response capture works on supported provider pages
- managed VS Code AI prompt/response capture works through the assessment extension's own AI panel
- arbitrary third-party VS Code chat panes may still influence downstream behavior signals without always producing a first-class captured `ide.ai.prompt` event

That distinction matters when reasoning about telemetry fidelity, but it does not change the fact that scoring itself is based on the 51-signal extraction pipeline.
