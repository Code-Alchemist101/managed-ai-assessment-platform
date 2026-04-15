# Release Status

## Date

- April 15, 2026

## Repo

- local path:
  - `C:\Users\hosan\Desktop\Research Project\assessment-platform`
- GitHub:
  - `https://github.com/Code-Alchemist101/managed-ai-assessment-platform`

## Current Product State

The repository is in strong local-v1 release-candidate territory.

What is already real:

- replay-fixture regression baseline
- managed desktop + VS Code live sessions
- managed desktop + VS Code + Edge live sessions
- control-plane-authoritative session detail and readiness
- reviewer/admin triage for successful and failed sessions
- local 51-signal extraction, integrity, HACI, and archetype outputs
- one-command and background local stack startup
- GitHub publication of the current local-v1 repo

## Latest Clean Baselines

### Default manifest

- clean baseline:
  - `f5455aeb-91d5-4261-a49d-b8f5c42136a2`

### Full manifest

- clean automated baseline on the integrated build:
  - `c5ebe45c-2888-4af7-8d1c-447709e8a12c`
- earlier clean full baseline:
  - `d0ad26fb-7a63-47f1-9763-9aaaf849f7be`

## Latest Human-Driven Full Session

- session:
  - `36e6bd86-2423-49b7-9da1-9247d7f62e04`
- outcome:
  - scored successfully
  - HACI `47.6`
  - archetype `Independent Solver`
  - policy recommendation `human-review`
  - integrity verdict `review`

### Why it was `review`

This was not a failed session. It was a successful scored session with review flags.

The stored scoring payload shows:

- `unsupported_site_visited`
- `sequence_gap_detected`

The raw browser telemetry for that session includes unsupported browsing such as:

- `www.bing.com`
- `www.w3schools.com`

So that session is best understood as:

- proof that the full flow works manually end to end
- proof that the policy layer can downgrade a session without blocking scoring
- not the clean acceptance baseline

## Important Operational Nuances

### Browser allowlist matters

For a clean full-manifest acceptance run, stay on allowlisted sites such as:

- `chat.openai.com`
- `claude.ai`
- `gemini.google.com`
- `stackoverflow.com`
- `developer.mozilla.org`
- `docs.python.org`
- `www.google.com`

Visiting unsupported sites can downgrade the session to `review`.

### VS Code AI telemetry nuance

The best first-class VS Code AI prompt/response telemetry currently comes from:

- `Assessment Platform: Open AI Assist`

inside the assessment extension.

If a candidate uses some other third-party VS Code chat pane, the resulting edit behavior is still visible through IDE events, but the exact prompt text may not always appear as a first-class `ide.ai.prompt` event.

### A scored session is not always a clean session

The policy layer is intentionally separate from the scoring math.

That means a session can:

- have all required streams
- produce HACI and archetype outputs
- and still land in `review`

This is intended product behavior.

## Best Next Actions For AntiGravity

1. Re-run:
   - `npm run build`
   - `npm run test:web`
   - `npm run test:integration`
   - `npm run test:analytics`
2. Run one strict allowlist-only human full-manifest acceptance pass
3. Use `npm run session:report -- <sessionId>`, `npm run session:report:latest`, or `npm run session:report:latest:json` for a quick local summary before opening raw runtime files by hand
4. Perform the signed-in provider sanity check in managed Edge
5. Investigate whether the `sequence_gap_detected` flags in the latest human run are a telemetry defect or an acceptable policy downgrade
6. Freeze local v1 after those items are understood
