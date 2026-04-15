# Operator Manual

For the latest baselines and handoff notes, see [Release Status](/C:/Users/hosan/Desktop/Research%20Project/assessment-platform/docs/release-status.md).

## Purpose

This manual is for the person actually running the local assessment platform on Windows.

It explains what to start, what windows should open, what a good session looks like, and how to recover from a stuck run.

## Before You Start

### Working folders

- Repo:
  - `C:\Users\hosan\Desktop\Research Project\assessment-platform`
- Recommended local test workspace:
  - `C:\Users\hosan\Desktop\Research Project\Test_folder`

### One-time setup

```powershell
cd "C:\Users\hosan\Desktop\Research Project\assessment-platform"
npm install
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r services\analytics-py\requirements.txt
```

## Fastest Way To Start The Product

From the repo root:

```powershell
npm run build
npm run dev:stack:start
```

For the full browser manifest:

```powershell
npm run dev:stack:start:full
```

Useful stack commands:

```powershell
npm run dev:stack:status
npm run dev:stack:stop
```

## What Opens During A Live Run

When you start a session, these windows opening is expected:

1. Electron desktop controller
2. VS Code Extension Development Host
3. Managed Edge window for browser-complete sessions

You may also see:

- Edge profile sync prompts
- Edge developer-mode extension warnings

Those are not automatically bugs. They come from the isolated managed Edge profile used for the session.

The product does **not** install the extension into your normal personal Edge profile.

## What Each Surface Is For

### Desktop controller

Use this to:

- pick the manifest
- start the live session
- see readiness and missing streams
- end and score the session
- abandon a stuck session

### VS Code Extension Development Host

Use this to generate IDE telemetry:

- open the chosen workspace
- edit files
- save files
- focus the editor

### Managed Edge window

Use this for browser telemetry in the full manifest:

- bootstrap into the exact session
- visit allowed sites
- optionally perform one provider prompt/response check

### Reviewer and admin

Use these to inspect the session:

- Reviewer:
  - `http://127.0.0.1:4173`
- Admin:
  - `http://127.0.0.1:4174`

## Default Manifest Run

### Goal

Validate the desktop + IDE live path.

### Steps

1. Run:

```powershell
npm run dev:stack:start
```

2. Open the desktop controller if it did not open automatically.
3. Leave the manifest picker on:
   - `manifest-python-cli-live-desktop-ide`
4. Click `Start Live Session`.
5. Select:
   - `C:\Users\hosan\Desktop\Research Project\Test_folder`
6. Wait for VS Code to open.
7. Make at least one real edit and save in the Extension Development Host.
8. Confirm the controller moves through:
   - `launching`
   - `awaiting_ide_stream`
   - `ready_to_score`
9. Click `End And Score Session`.
10. Open reviewer/admin and confirm:
   - required streams satisfied
   - `desktop + ide` present
   - integrity verdict `clean`

## Full Manifest Run

### Goal

Validate desktop + IDE + browser capture together.

### Steps

1. Run:

```powershell
npm run dev:stack:start:full
```

2. In the desktop controller, pick:
   - `manifest-python-cli-live-full`
3. Click `Start Live Session`.
4. Select:
   - `C:\Users\hosan\Desktop\Research Project\Test_folder`
5. Confirm VS Code opens automatically.
6. Confirm managed Edge opens automatically.
7. In VS Code, make at least one real edit and save.
8. In Edge, let the bootstrap page load and browse only allowlisted sites if you want the cleanest possible run:
   - `chat.openai.com`
   - `claude.ai`
   - `gemini.google.com`
   - `stackoverflow.com`
   - `developer.mozilla.org`
   - `docs.python.org`
   - `www.google.com`
9. Avoid unsupported sites such as `www.bing.com` and `www.w3schools.com` during a clean acceptance run.
10. Confirm the controller does not let you score until both IDE and browser telemetry are present.
11. End and score the session.
12. Confirm reviewer/admin show:
   - `desktop + ide + browser`
   - no missing required streams
   - integrity verdict `clean`

## Provider Prompt/Response Check

### Purpose

This confirms supplemental browser AI evidence on top of browser completeness.

### Steps

1. Start a full-manifest session.
2. In the managed Edge window, open one supported provider:
   - `chat.openai.com`
   - `claude.ai`
   - `gemini.google.com`
3. Sign in inside that managed Edge session if required.
4. Send one short prompt.
5. Wait for one visible response.
6. In reviewer or the session events API, confirm the same session contains:
   - `browser.ai.prompt`
   - `browser.ai.response`

### Important note

This is still the one meaningful manual polish check left after the latest automated clean full-manifest run. It requires a signed-in browser interaction, so it is not something the local scripts can complete honestly on their own.

## VS Code AI Note

- The strongest first-class VS Code AI prompt/response telemetry currently comes from the assessment extension's own `Assessment Platform: Open AI Assist` command.
- If you use some other third-party VS Code chat surface, the edit behavior is still visible through IDE events, but the exact prompt text may not always appear as a first-class `ide.ai.prompt` event.

## Recovery If A Session Gets Stuck

Use this when the controller says a stream is still missing and the run is not progressing.

1. Look at the readiness reason in the desktop controller.
2. If the session is clearly stuck, click `Abandon Session`.
3. Confirm a new session can be started.
4. Start a fresh run instead of trying to rescue a broken one.

Typical reasons for a stuck session:

- no IDE activity yet
- managed Edge did not finish bootstrap
- operator never interacted in one of the required surfaces

## Interpreting A `review` Verdict

A session can be:

- fully scored
- complete enough to include `desktop + ide + browser`
- and still land in `review`

Typical reasons:

- unsupported browser sites were visited
- telemetry sequence gaps were detected
- heartbeat evidence was missing

The latest human-driven full-manifest session is a good example:

- session: `36e6bd86-2423-49b7-9da1-9247d7f62e04`
- result: scored successfully
- verdict: `review`
- reason: unsupported-site and sequence-gap flags

## Useful Commands And Checks

### Health checks

```powershell
curl.exe -s http://127.0.0.1:4030/health
curl.exe -s http://127.0.0.1:4020/health
curl.exe -s http://127.0.0.1:4010/health
```

### Session inspection

```powershell
curl.exe -s http://127.0.0.1:4010/api/manifests
curl.exe -s http://127.0.0.1:4010/api/sessions
curl.exe -s http://127.0.0.1:4010/api/sessions/<sessionId>
curl.exe -s http://127.0.0.1:4010/api/sessions/<sessionId>/bootstrap
curl.exe -s http://127.0.0.1:4010/api/sessions/<sessionId>/scoring
curl.exe -s http://127.0.0.1:4010/api/sessions/<sessionId>/events
npm run session:report -- <sessionId>
npm run session:report:latest
npm run session:report:latest:json
```

`session:report` is the fastest local diagnostic command when a run scores but lands in `review`. It summarizes HACI, archetype, integrity flags, source mix, unsupported browser sites, and sequence anomalies from the saved runtime files. Use `npm run session:report:latest` to inspect the latest scored session immediately, or `npm run session:report:latest:json` when another tool needs structured output.

### Build and tests

```powershell
npm run build
npm run test:web
npm run test:integration
npm run test:analytics
```

## Known Good Session IDs

Useful clean references already present in local validation history:

- Default clean baseline:
  - `f5455aeb-91d5-4261-a49d-b8f5c42136a2`
- Full clean baseline:
  - `d0ad26fb-7a63-47f1-9763-9aaaf849f7be`
- Latest automated clean full baseline:
  - `c5ebe45c-2888-4af7-8d1c-447709e8a12c`
- Latest human-driven full session:
  - `36e6bd86-2423-49b7-9da1-9247d7f62e04`
  - scored successfully, but verdict `review`

## When To Stop The Stack

When you are done:

```powershell
npm run dev:stack:stop
```

If you started individual services instead of the background stack manager, stop them by closing those terminals manually.
