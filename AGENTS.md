# Agent Guidance

This file is a lightweight operating note for future AI agents taking over this repository.

It does not guarantee automatic model switching, but it gives the clearest recommended model-routing policy for AntiGravity or any similar agentic coding workflow.

## Primary Repo

- `C:\Users\hosan\Desktop\Research Project\assessment-platform`

## First Files To Read

1. [README.md](/C:/Users/hosan/Desktop/Research%20Project/assessment-platform/README.md)
2. [docs/antigravity-kt.md](/C:/Users/hosan/Desktop/Research%20Project/assessment-platform/docs/antigravity-kt.md)
3. [docs/release-status.md](/C:/Users/hosan/Desktop/Research%20Project/assessment-platform/docs/release-status.md)
4. [docs/architecture.md](/C:/Users/hosan/Desktop/Research%20Project/assessment-platform/docs/architecture.md)
5. [docs/data-flow-walkthrough.md](/C:/Users/hosan/Desktop/Research%20Project/assessment-platform/docs/data-flow-walkthrough.md)
6. [docs/operator-manual.md](/C:/Users/hosan/Desktop/Research%20Project/assessment-platform/docs/operator-manual.md)

## Product Guardrails

- Do not redesign or break the replay-fixture baseline.
- Do not reintroduce browser attribution via `latest_session_id`.
- Do not undo the working Windows `Code.exe` launch preference.
- Keep `manifest-python-cli-live-desktop-ide` as the default local smoke path.
- Keep provider-specific browser capture additive, not a new completeness requirement.
- Remember that a session can score successfully and still land in `review`.

## Recommended Model Routing

Use these models as a toolkit, not interchangeably.

### Default main model

- `Gemini 3.1 Pro (High)`

Use for:

- initial repo takeover
- architecture understanding
- cross-file debugging
- telemetry and integrity reasoning
- manual smoke-test interpretation
- planning the next technical steps

### Best writing and product-polish model

- `Claude Sonnet 4.6 (Thinking)`

Use for:

- README, KT, runbook, and handoff updates
- UX wording
- product positioning
- reviewer/admin explanation text
- high-clarity design tradeoff writeups

### Deepest escalation model

- `Claude Opus 4.6 (Thinking)`

Use sparingly for:

- hardest architecture decisions
- subtle scoring/integrity questions
- major telemetry-policy tradeoffs
- “think carefully before changing this” moments

### Cost-saving medium model

- `Gemini 3.1 Pro (Low)`

Use for:

- medium-sized edits
- follow-up implementation after the plan is already clear
- reading a few files and making bounded changes

### Fast utility model

- `Gemini 3 Flash`

Use for:

- quick summaries
- log reading
- command help
- short transformations
- low-risk utility tasks

### Fallback only

- `GPT-OSS 120B (Medium)`

Use only as a backup for:

- lightweight code help
- drafting
- quick second opinions when stronger models are unavailable

## Recommended Session Strategy

1. Start major takeover/debugging sessions on `Gemini 3.1 Pro (High)`.
2. Switch to `Claude Sonnet 4.6` when the task becomes documentation, polish, or communication-heavy.
3. Escalate to `Claude Opus 4.6` only when the problem is genuinely difficult and risky.
4. Use `Gemini 3 Flash` for fast utility checks so stronger model availability lasts longer.

## Current Local Diagnostic Commands

```powershell
npm run dev:stack:start:full
npm run session:report:latest
npm run session:report:latest:json
```

## Important Session Evidence

- Latest human-driven full-manifest scored session:
  - `36e6bd86-2423-49b7-9da1-9247d7f62e04`
  - verdict: `review`
  - flags: `sequence_gap_detected`, `unsupported_site_visited`
- Latest automated clean full baseline:
  - `c5ebe45c-2888-4af7-8d1c-447709e8a12c`
- Default clean baseline:
  - `f5455aeb-91d5-4261-a49d-b8f5c42136a2`

## Practical Note

If you are AntiGravity or another agent taking over this repo, read the KT and release-status docs before changing code. The highest-value next work is understanding the difference between:

- a scored session
- a clean session
- a review-routed session

That distinction is fundamental to this product.
