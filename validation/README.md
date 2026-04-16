# Validation Framework

This directory contains the **minimum viable evaluation harness** for the assessment platform scoring pipeline. It is designed to be grown incrementally—starting from a small, manually-labeled set of sessions—without requiring a full data platform or large annotation effort.

---

## What Is Already Available

| Asset | Location | Description |
|---|---|---|
| Replay fixture | `fixtures/sample-session.json` | Single 32-event demo session; used by integration tests and the local demo runner |
| Heuristic scoring | `services/analytics-py/assessment_analytics/scoring.py` | `score_session()` always computes a heuristic result |
| Trained-model scoring | `services/analytics-py/assessment_analytics/scoring.py` | `score_session()` also attempts trained-model scoring when artifacts are present |
| Reviewer decisions | `.runtime-data/control-plane/review-decisions/{id}.json` | `decision`, `note`, `decided_at` — written by control-plane API at runtime |
| Test scripts | `npm run test:analytics`, `npm run test:integration`, `npm run test:web` | Existing test suite; analytics tests use `services/analytics-py/tests/` |
| Session report | `npm run session:report:latest` | Human-readable scoring summary for any local-dev session |
| Integrity flags | `services/analytics-py/assessment_analytics/integrity.py` | Flags including `low_information_session` for very short/sparse sessions |

---

## Labeled Session Format

Each file in `validation/labeled-sessions/` is a self-contained JSON object that extends the existing fixture format with a `label` block.

```json
{
  "label": {
    "reviewer_archetype": "Structured Collaborator",
    "reviewer_decision": "approve",
    "reviewer_confidence": "high",
    "reviewer_note": "Human-readable rationale for this label.",
    "labeled_by": "human",
    "labeled_at": "2026-04-16T12:00:00Z"
  },
  "session_context": {
    "session_id": "val-001",
    "problem_statement": "...",
    "allowed_ai_providers": ["openai"],
    "allowed_sites": ["docs.python.org"],
    "required_streams": ["desktop", "ide", "browser"]
  },
  "events": [
    {
      "event_id": "evt-001",
      "session_id": "val-001",
      "timestamp_utc": "...",
      "source": "desktop",
      "event_type": "session.started",
      "sequence_no": 1,
      "artifact_ref": "session",
      "payload": {},
      "client_version": "0.1.0",
      "integrity_hash": "hash-001",
      "policy_context": {"managed_session": true}
    }
  ]
}
```

### Field Definitions

| Field | Type | Values | Notes |
|---|---|---|---|
| `reviewer_archetype` | string | One of the seven archetypes (see below) | The ground-truth label; what a human reviewer judged the session to represent |
| `reviewer_decision` | string | `approve`, `reject`, `needs_followup` | What action the reviewer would take |
| `reviewer_confidence` | string | `high`, `medium`, `low` | Reviewer's self-reported confidence in the label |
| `reviewer_note` | string | free text | Rationale; should explain the key behavioral signals that drove the label |
| `labeled_by` | string | `human`, `synthetic` | `human` = real or carefully manual label; `synthetic` = programmatically assigned |
| `labeled_at` | ISO 8601 | — | When the label was assigned |

### Valid Archetype Values

- `AI-Dependent Constructor`
- `Blind Copier`
- `Exploratory Learner`
- `Independent Solver`
- `Iterative Debugger`
- `Prompt Engineer Solver`
- `Structured Collaborator`

These match the values in `services/analytics-py/assessment_analytics/catalog.py`.

---

## How to Store Real Reviewer Labels

When a real reviewer decision is made via the reviewer UI, the control-plane API stores it at `.runtime-data/control-plane/review-decisions/{sessionId}.json`. To convert a runtime reviewer decision into a validation label:

1. Export the reviewer decision JSON and the session events NDJSON (from `.runtime-data/local-dev/ingestion/sessions/{id}.ndjson`).
2. Convert the NDJSON events to a JSON array.
3. Merge into the labeled-session format above, setting `labeled_by: "human"`.
4. Assign `reviewer_archetype` based on the reviewer's qualitative assessment (the automated `predicted_archetype` is a candidate but should be verified).
5. Place the file in `validation/labeled-sessions/`.

There is no automated pipeline for this yet—it is intentionally a manual step to ensure label quality.

---

## Metrics Computed

The harness (`evaluate.py`) computes four categories of metrics:

### 1. Accuracy
For each scored session, compare `predicted_archetype` (heuristic or trained model) against `reviewer_archetype`. Report `correct / total` for each scoring mode.

### 2. Class-wise Confusion
A `reviewer_label → predicted_label → count` matrix for both scoring modes. Identifies systematic mislabeling, e.g., "AI-Dependent Constructor" sessions being predicted as "Independent Solver".

### 3. Dual-Mode Delta
The rate at which the heuristic and trained-model predictions **disagree** on the same session. Useful for identifying sessions where the two modes diverge and where trained-model investment may have the most impact.

### 4. Short-Session Bias
Accuracy split by session length, using a threshold of `n_events < 10` (the same threshold used by `integrity.py` for `low_information_session`). A lower accuracy on short sessions, particularly with over-representation of `Independent Solver`, confirms the known sparse-signal bias risk.

---

## Running the Evaluation

```bash
# Human-readable report
python validation/evaluate.py

# Machine-readable JSON (for scripting or CI integration)
python validation/evaluate.py --json
```

Run from the **repository root**. The script imports `assessment_analytics` from `services/analytics-py/`, mirroring the path setup in `services/analytics-py/tests/test_pipeline.py`. Python requirements must be installed (`pip install -r services/analytics-py/requirements.txt`).

---

## Heuristic vs Trained-Model Comparison Method

For each labeled session, `evaluate.py` scores it through both modes in a single `score_session()` call (which always attempts both). The output includes:

- `heuristic_predicted` / `heuristic_confidence`
- `trained_predicted` / `trained_confidence` (or `null` if model artifacts are unavailable)
- `heuristic_match` / `trained_match` — boolean match against reviewer label
- `modes_agree` — whether both modes predicted the same archetype

This allows direct per-session and aggregate comparison without any additional infrastructure.

---

## Short-Session Bias Analysis — Stepwise Plan

1. **Identify short sessions in the labeled set.** `evaluate.py` groups results by `n_events < 10` vs `>= 10` automatically. The `is_short_session` field is included in JSON output.

2. **Check for `low_information_session` flag.** This integrity flag is set when a session has fewer than 10 events, at least one insert event, no paste events, and no AI prompts. If a session is short but does not trigger this flag, it may still have useful signal. Compare flag presence vs labeling accuracy.

3. **Inspect the predicted archetype distribution.** Look at the heuristic confusion matrix for short sessions only. If `Independent Solver` appears disproportionately as the predicted label for mismatched short sessions, that confirms the known bias.

4. **Extend the labeled set with targeted short sessions.** Add more `val-00x-short-*.json` files with varied short-session patterns (e.g., short session with browser AI events, short session with paste only) to measure bias boundary conditions.

5. **Compare integrity flag rate vs mislabel rate.** The `low_information_session` flag should correlate with reduced labeling confidence. If a session is flagged but correctly labeled, that is a success case for the current hardening. If a session is flagged and mislabeled, it is a scoring-quality risk that may warrant additional policy action.

6. **Iterate**: as real-session data becomes available, add labeled sessions and re-run `evaluate.py` to track improvement over time.

---

## Current Labeled Sessions

| File | Session ID | N Events | Reviewer Label | Notes |
|---|---|---|---|---|
| `val-001-structured-collaborator.json` | val-001 | 19 | Structured Collaborator | Typed first, then targeted AI use |
| `val-002-short-sparse.json` | val-002 | 6 | Independent Solver (low confidence) | Short session; triggers `low_information_session` |
| `val-003-independent-solver.json` | val-003 | 20 | Independent Solver | Long typing-only session, no AI |
| `val-004-ai-dependent.json` | val-004 | 22 | AI-Dependent Constructor | Immediate AI use, solution-seeking prompts, bulk paste |

These are synthetic but behaviorally plausible sessions. Real human-labeled sessions should be added as they become available.

---

## Adding New Labeled Sessions

1. Create a new JSON file in `validation/labeled-sessions/` following the format above.
2. Run `python validation/evaluate.py` to confirm it is loaded and scored without errors.
3. The session will be automatically included in all metric computations.

Naming convention: `val-NNN-<short-description>.json`, e.g., `val-005-blind-copier.json`.

---

## Limitations of This Framework

- **Small labeled set.** Four sessions is not statistically meaningful. Accuracy numbers should be treated as directional indicators only.
- **Synthetic labels.** All current labeled sessions are manually constructed, not from real candidate behavior.
- **No calibration.** Model confidence values (from `predict_proba`) are not calibrated probabilities. Do not interpret them as frequentist likelihoods.
- **No test-set separation.** The labeled sessions here were not used to train the model, but the synthetic training data and these synthetic labeled sessions may share distributional assumptions.

These limitations are documented in `docs/model-card.md`.
