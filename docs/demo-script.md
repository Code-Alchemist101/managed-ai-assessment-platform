# Demo Script

For the latest baselines and known caveats, see [Release Status](/C:/Users/hosan/Desktop/Research%20Project/assessment-platform/docs/release-status.md).

## Goal

Use this script for a 10 to 15 minute product walkthrough with a reviewer, evaluator, professor, hiring team, or potential integration partner.

The goal is to show three things clearly:

1. The system manages the assessment session, not just the final code submission.
2. The control plane can explain session completeness and integrity.
3. The product is useful for AI-era hiring and post-training evaluation.

## Before the demo

Start the local stack from the repository root:

```powershell
npm run build
npm run dev:stack:start:full
```

Keep these ready:

- reviewer: `http://127.0.0.1:4173`
- admin: `http://127.0.0.1:4174`
- control plane: `http://127.0.0.1:4010`
- local test workspace:
  - `C:\Users\hosan\Desktop\Research Project\Test_folder`

## Opening narrative

Suggested opener:

"Most coding assessments still judge only the final answer. This platform evaluates how the work was done inside a managed AI-assisted session by combining desktop, IDE, and browser evidence into completeness, integrity, and scoring outputs."

## Demo flow

### Part 1: Show the system surfaces

Open:

- desktop controller
- reviewer
- admin

Explain:

- desktop controller starts and governs managed sessions
- reviewer is the evidence and scoring surface
- admin is the operator inventory and session inspection surface

### Part 2: Show manifest selection

In the desktop controller:

- point out the manifest picker
- show the default desktop + IDE manifest
- show the full desktop + IDE + browser manifest

Talking point:

"This lets the operator choose the required evidence model before the session starts. The picker locks during an active session so the evidence contract cannot drift mid-run."

### Part 3: Run the default live session

Use `manifest-python-cli-live-desktop-ide`.

Steps:

1. Click `Start Live Session`.
2. Choose `C:\Users\hosan\Desktop\Research Project\Test_folder`.
3. Show the readiness progression:
   - `launching`
   - `awaiting_ide_stream`
   - `ready_to_score`
4. Show VS Code auto-opening.
5. Make a small edit and save in the Extension Development Host window.
6. End and score the session.

What to emphasize:

- scoring is gated until the required stream exists
- the control plane is tracking completeness, not trusting the desktop UI blindly
- reviewer/admin show a real live session, not a canned demo artifact

### Part 4: Run the full manifest session

Use `manifest-python-cli-live-full`.

Steps:

1. Select the full manifest in the picker.
2. Start a new session.
3. Show that VS Code opens.
4. Show that Edge opens in the managed isolated profile.
5. Show that scoring remains locked until both IDE and browser streams appear.
6. For a clean demo run, stay on allowlisted sites only.

What to emphasize:

- the browser is attached to the exact session using bootstrap
- this does not rely on `latest_session_id`
- browser completeness is additive to desktop and IDE evidence

### Part 5: Provider sanity check

Inside the managed Edge window:

1. Open one supported provider page:
   - `chat.openai.com`
   - `claude.ai`
   - `gemini.google.com`
2. Sign in if needed.
3. Send one prompt and wait for a visible response.

What to emphasize:

- provider events are supplemental evidence, not the only browser signal
- the session is still judged by completeness plus integrity, not just "AI was used"

### Part 6: Reviewer walkthrough

Open the session in reviewer and explain:

- required streams
- present streams
- missing streams
- integrity verdict
- policy recommendation
- HACI score
- predicted archetype

Talking point:

"This is valuable because the reviewer can see whether the session is incomplete, invalid, or simply human-review-worthy, instead of getting one opaque score with no operational context."

### Part 7: Admin walkthrough

Open admin and explain:

- manifests inventory
- recent sessions table
- session status and missing streams
- reviewer deep links

Talking point:

"This is the operator view that makes the product usable in a real workflow, not just as a one-off prototype."

## Recovery path if the live demo flakes

If a session gets stuck:

1. Show `Abandon Session`.
2. Explain that the session is explicitly marked invalid instead of being silently ignored.
3. Start a fresh session.

If you do not want to rerun live, fall back to saved clean baselines:

- default clean baseline:
  - `f5455aeb-91d5-4261-a49d-b8f5c42136a2`
- full clean browser baseline:
  - `d0ad26fb-7a63-47f1-9763-9aaaf849f7be`
- latest human-driven scored-but-reviewed full session:
  - `36e6bd86-2423-49b7-9da1-9247d7f62e04`
  - useful when explaining the difference between a scored session and a clean session

## Closing narrative

Suggested closer:

"The important point is not just that we can score code. The important point is that we can run a managed AI-enabled session, verify whether the required evidence is actually present, and give reviewers a structured view of how the candidate worked."

If asked why a session can score and still route to review, say:

"That is intentional. The score and the integrity policy layer are separate, so the platform can preserve evidence and scoring while still escalating unsupported or suspicious behavior for human review."

## What to say if asked about commercialization

Suggested answer:

"The current repository is a strong local v1. The next commercial step is not a scoring redesign. It is a hosted control plane, signed launch flow, result webhooks, and partner integration with existing assessment platforms or enterprise training systems."
