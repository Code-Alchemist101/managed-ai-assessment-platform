# Validation Plan (Phase 1)

This document defines the **smallest credible first validation layer** for evaluating scoring quality on real or realistically labeled sessions, without introducing a large evaluation subsystem in one PR.

## What already exists in this repository

| Area | Existing assets |
|---|---|
| Replay fixtures | `fixtures/sample-session.json` and integration replay path via `POST /api/demo/replay-fixture` |
| Scoring outputs | `score_session()` in `services/analytics-py/assessment_analytics/scoring.py` returns active top-level scoring plus `heuristic_result` and `trained_model_result` (when artifacts load) |
| Reviewer decisions | Stored at `.runtime-data/control-plane/review-decisions/{sessionId}.json` via `GET/POST /api/sessions/:sessionId/decision` |
| Runtime/test scripts | `npm run test:analytics`, `npm run test:integration`, `npm run test:web`, and `npm run session:report:latest[:json]` |
| Short-session signal | `low_information_session` integrity flag in `services/analytics-py/assessment_analytics/integrity.py` for sparse short typing-only sessions |

## Proposed labeled-session data format

Use one JSON file per labeled session under `validation/labeled-sessions/` with the existing fixture shape plus a `label` block.

```json
{
  "label": {
    "reviewer_archetype": "Structured Collaborator",
    "reviewer_decision": "approve",
    "reviewer_confidence": "high",
    "reviewer_note": "Short rationale for why this label was chosen.",
    "labeled_by": "human",
    "labeled_at": "2026-04-16T12:00:00Z"
  },
  "session_context": { "...": "existing fixture fields" },
  "events": [{ "...": "existing event fields" }]
}
```

`reviewer_archetype` should use existing catalog values (`AI-Dependent Constructor`, `Blind Copier`, `Exploratory Learner`, `Independent Solver`, `Iterative Debugger`, `Prompt Engineer Solver`, `Structured Collaborator`).

## How reviewer labels should be stored

1. Reviewer action source-of-truth remains control-plane decision files (`.runtime-data/control-plane/review-decisions/{sessionId}.json`).
2. For validation datasets, copy reviewer outcome into the `label` block above and pair it with session telemetry (`session_context` + `events`).
3. Keep `reviewer_note` required for human labels to preserve rationale and improve later adjudication quality.
4. Start with manual curation; avoid building automated ingestion in this phase.

## Metrics to compute (minimum viable trust signals)

1. **Accuracy** (heuristic and trained-mode separately): `predicted_archetype == reviewer_archetype`.
2. **Class-wise confusion**: `reviewer_archetype -> predicted_archetype` counts for each mode.
3. **Dual-mode delta**: disagreement rate between heuristic and trained predictions on the same labeled session.
4. **Short-session bias**: metric breakdown by short vs non-short sessions (initial split: `event_count < 10` vs `>= 10`, aligned with current integrity flag threshold).

## Practical method to compare heuristic vs trained model

For each labeled session:
- run scoring once through existing pipeline;
- record `heuristic_result.predicted_archetype` and `trained_model_result.predicted_archetype` (if available);
- compare each against reviewer label;
- compute per-mode accuracy/confusion and cross-mode disagreement.

Do this first with lightweight manual/Notebook/script analysis outside core product runtime; no platform refactor required.

## Stepwise plan for short-session bias analysis

1. Tag labeled sessions as short/non-short using event count.
2. Track whether each short session has `low_information_session`.
3. Compare error rates between short and non-short groups.
4. Inspect confusion for short sessions specifically (watch for overprediction of `Independent Solver`).
5. Expand short-session labeled coverage with diverse sparse patterns (typing-only, paste-heavy, prompt-heavy) and repeat.
6. If bias persists, propose a narrow follow-up mitigation (reviewer warning, stricter low-information handling, or policy guardrail) in a separate PR.

## Incremental scope for this phase

- This PR is planning-first.
- No multi-session synthetic benchmark claims.
- No reported accuracy claims from tiny handcrafted sets.
- Optional scaffolding only: `validation/labeled-sessions/.gitkeep` placeholder for future labeled files.
