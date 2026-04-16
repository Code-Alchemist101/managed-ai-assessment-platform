# Regression Test Plan — Trust/Correctness PRs 1–5

**Date:** 2026-04-16  
**Scope:** PRs merged or in-progress since the sequence began:
- PR 1 – Honest confidence/score-strength labeling
- PR 2 – Per-manifest policy override (`auto_advance_min_confidence`)
- PR 3 – Reviewer notes in the decision workflow
- PR 4 – Expandable timeline (removes 10-event cap)
- PR 5 – Dual scoring reviewer UX (Active / Policy Driver + COMPARATIVE labels, disagreement banner)

**Constraints:** No code or test writing yet. Grounded in the actual main branch.  
**Test files inspected:**
- `services/analytics-py/tests/test_pipeline.py`
- `tests/web/view-models.test.ts`
- `tests/web/admin-view-models.test.ts`
- `tests/integration/live-session.test.ts`
- `tests/integration/demo-runner.test.ts`

---

## 1. Existing Automated Test Coverage

### 1a. Scoring correctness

| Behaviour | Test | File |
|---|---|---|
| Default threshold (0.90) → `human-review` when confidence < 0.90 | `test_policy_default_threshold_applied_when_no_decision_policy` | `test_pipeline.py` |
| Lower override (0.10) → `auto-advance` when confidence > 0.10 | `test_policy_override_lowers_auto_advance_threshold` | `test_pipeline.py` |
| Higher override (0.95) → `human-review` when confidence < 0.95 | `test_policy_override_raises_threshold_above_session_confidence` | `test_pipeline.py` |
| Default mode is `heuristic` | `test_scoring_defaults_to_heuristic_mode` | `test_pipeline.py` |
| `heuristic_result` always present | `test_scoring_always_includes_heuristic_result` | `test_pipeline.py` |
| `trained_model_result` present when artifacts available | `test_scoring_includes_trained_model_result_when_artifacts_available` | `test_pipeline.py` |
| `trained_model_result` is `None` when artifacts unavailable | `test_scoring_trained_model_result_is_none_when_artifacts_unavailable` | `test_pipeline.py` |
| Trained-model mode active when `ARCHETYPE_MODE=trained_model` | `test_scoring_supports_trained_model_mode` | `test_pipeline.py` |
| Fallback to heuristic when artifacts unavailable | `test_scoring_falls_back_to_heuristic_when_artifacts_unavailable` | `test_pipeline.py` |
| HACI is stable across both modes | `test_haci_is_stable_across_scoring_modes` | `test_pipeline.py` |
| `confidenceLabel("heuristic")` → `"Score Strength"` | `confidenceLabel returns mode-aware label…` | `view-models.test.ts` |
| `confidenceLabel("trained_model")` → `"Model Confidence"` | same test | `view-models.test.ts` |
| Unknown mode falls back to `"Score Strength"` | same test | `view-models.test.ts` |

### 1b. Reviewer workflow

| Behaviour | Test | File |
|---|---|---|
| `formatReviewerDecision` formats all three decision values | `formatReviewerDecision formats decision values…` | `view-models.test.ts` |
| `buildCompletenessSummary` with an invalid session | `reviewer completeness helpers support…` | `view-models.test.ts` |
| `resolvePreferredSessionId` resolves query parameter | same test | `view-models.test.ts` |

> **Gap:** No integration test exercises `POST /api/sessions/:id/decision` or `GET /api/sessions/:id/decision`.  
> The API routes exist in `services/control-plane-api/src/app.ts` (lines 556–602) and `reviewDecisionsDir` is wired in the runtime for integration tests, but neither `demo-runner.test.ts` nor `live-session.test.ts` ever calls these endpoints.  
> Note persistence (the `note` field) has **zero** automated test coverage.

### 1c. Dual scoring reviewer UX

| Behaviour | Test | File |
|---|---|---|
| `scoringModesDisagree(null)` → `false` | `scoringModesDisagree detects archetype disagreement…` | `view-models.test.ts` |
| Only `heuristic_result` present → `false` | same test | `view-models.test.ts` |
| Both results agree → `false` | same test | `view-models.test.ts` |
| Both results disagree → `true` | same test | `view-models.test.ts` |
| `buildArchetypeProbabilityEntriesFromMap` with a raw map | `buildArchetypeProbabilityEntriesFromMap ranks…` | `view-models.test.ts` |

> **Gap:** The `ScoringModeCard` component (`apps/reviewer-web/src/App.tsx:502–553`) renders the `ACTIVE · POLICY DRIVER` and `COMPARATIVE` badges, the blue-ring highlight, and the disagreement banner. None of this rendering is covered by any automated test. Coverage is view-model-layer only; component-layer is zero.

### 1d. Timeline and >10-event sessions

| Behaviour | Test | File |
|---|---|---|
| `buildTimelineEntries` with 15 events returns all 15 (no cap) | `buildTimelineEntries returns all events beyond the former 10-event cap` | `view-models.test.ts` |
| `eventCount` reflects the full event set | same test | `view-models.test.ts` |
| Basic two-event timeline labels | `reviewer view models map scoring and events…` | `view-models.test.ts` |

> **Gap:** The expand/collapse UI behavior in `App.tsx` (the `timelineExpanded` flag that slices at 10 for the initial view and the "Show all N events" button) is not tested. The view-model layer is correct, but the rendering toggle and its reset on session switch (`setTimelineExpanded(false)`) are manual-only.

### 1e. Integration (end-to-end pipeline)

| Behaviour | Test | File |
|---|---|---|
| Clean desktop+IDE session scores correctly | `live desktop + ide session scores clean…` | `live-session.test.ts` |
| Desktop-only session is invalid, missing streams reported | `desktop-only live session is invalid…` | `live-session.test.ts` |
| Full manifest with browser telemetry scores clean | `full live manifest exposes browser bootstrap…` | `live-session.test.ts` |
| Demo replay produces scored session with persisted scoring + events | `demo replay creates a scored session…` | `demo-runner.test.ts` |

---

## 2. What Is Untested or Weakly Tested

### Critical gaps (high risk, recent code changed here)

| Gap | Risk | Affected PR |
|---|---|---|
| `POST /api/sessions/:id/decision` with a `note` — no integration test at all | A regression in note persistence or serialization would be silent | PR 3 |
| `GET /api/sessions/:id/decision` — no integration test | Missing decision on reload would go undetected | PR 3 |
| Session switch resetting `noteInput` to the new session's saved note (or `""`) — purely React state, no test | Stale note from a previous session could be submitted against the wrong session | PR 3 |
| Session switch resetting `timelineExpanded` to `false` — purely React state, no test | Timeline could remain expanded from a prior session unexpectedly | PR 4 |

### Moderate gaps (untested edge paths)

| Gap | Risk |
|---|---|
| `auto_reject_enabled` and `require_full_completeness` policy fields — only `auto_advance_min_confidence` is tested | These fields may silently do nothing if wiring is incomplete |
| HACI gate (score must be ≥ 65 for auto-advance) not tested independently of the confidence gate | Boundary at HACI = 65 could regress without notice |
| Confidence exactly equal to `auto_advance_min_confidence` (boundary condition) | Off-by-one or inclusive/exclusive edge at the threshold not verified |
| `session_context` is `None` (fully absent) — `score_session` default path | Though the defaults look correct, this code path is not tested explicitly |
| Empty events list passed to `score_session` | Could surface unexpected division-by-zero or index errors in feature extraction |
| `scoringModesDisagree` when `trained_model_result` is present but `heuristic_result` is absent | Logically covered by `!scoring?.heuristic_result` guard, but not tested explicitly |
| Reviewer decision with an empty string note vs. absent note (note trimming in `handleDecision`) | `noteInput.trim() || undefined` in `App.tsx:170` but the distinction is untested |
| Decision load error (network failure during `loadDecision`) — UI error path | Error state renders without crashing? Manual only. |

### Known zero-coverage areas

- React component rendering of the `ScoringModeCard`, disagreement banner, note textarea, timeline expand button
- All of `apps/reviewer-web/src/App.tsx` render paths (no component tests of any kind)
- `apps/admin-web` view models have one test but no coverage of the reviewer-URL construction for edge cases

---

## 3. Smallest Useful Manual Integrity-Check Checklist

Run against the local stack (`npm run dev:stack:start:full` + demo fixture replay).  
Each item should take under 2 minutes. Total estimated time: 20–25 minutes.

### A. Scoring correctness

- [ ] **A1 — Default threshold applies**  
  Replay the demo fixture. Open the reviewer panel. Confirm `Policy Recommendation` shows `human-review` (fixture confidence ~0.18 < default 0.90 threshold).

- [ ] **A2 — Honest confidence labeling**  
  In the reviewer panel's Heuristic Result card, confirm the label reads **Score Strength**, not "Confidence".  
  In the Trained-Model Result card (if present), confirm the label reads **Model Confidence**.

- [ ] **A3 — Active mode display**  
  In Scoring Provenance, confirm "Active mode" matches the top-level `scoring_mode` in the session JSON. Confirm the card with `isActive=true` has a blue border ring; the other card does not.

### B. Reviewer workflow

- [ ] **B1 — Decision save**  
  Select a session. Choose "Approve". Click the Approve button. Confirm the panel shows "Current decision: Approve (recorded …)".

- [ ] **B2 — Decision persists on reload**  
  Hard-reload the reviewer page (Ctrl+F5). Confirm the decision from B1 is still shown.

- [ ] **B3 — Note save**  
  Select a session. Enter text in the Reviewer Note textarea. Click any decision button. Reload the page. Confirm the note text is shown in italic below the decision.

- [ ] **B4 — Session switch clears stale note**  
  With session A selected and a note visible, select session B (which has no note). Confirm the note textarea is empty and no stale note is displayed.

- [ ] **B5 — Timeline expand/collapse resets on session switch**  
  With session A (>10 events) selected, click "Show all N events". Switch to session B. Switch back to session A. Confirm the timeline is collapsed (showing only 10 events) again.

### C. Dual scoring UX

- [ ] **C1 — Active · Policy Driver badge**  
  Confirm the card for the active mode (matching `scoring_mode` in the payload) shows the blue **ACTIVE · POLICY DRIVER** badge. Confirm the other card shows the gray **COMPARATIVE** badge.

- [ ] **C2 — Disagreement banner**  
  If `heuristic_result.predicted_archetype ≠ trained_model_result.predicted_archetype`, confirm the amber "Scoring modes disagree" banner appears between the two cards.  
  If the archetypes agree, confirm the banner is absent.

- [ ] **C3 — Trained-model unavailable**  
  In a heuristic-only environment (no XGBoost artifacts), confirm the Trained-Model Result card shows "Artifacts not loaded — heuristic used as fallback" and no disagreement banner appears.

### D. Edge cases

- [ ] **D1 — Session with >10 events**  
  Load a session with more than 10 events (the fixture has many). Confirm the timeline shows 10 events initially, then "Show all N events". Click the button; confirm all events appear.

- [ ] **D2 — Session with no scoring**  
  Load a session that has not been scored. Confirm the reviewer panel shows "pending" for verdict and policy recommendation, and no archetype probability or feature section renders (graceful empty state).

- [ ] **D3 — Empty decision state**  
  On a freshly replayed session with no reviewer decision, confirm the panel shows "No decision recorded yet." and no note line appears.

- [ ] **D4 — Empty note (decision without a note)**  
  Save a decision without entering any note text. Reload. Confirm no note line appears in the decision section.

---

## 4. Recommendation: Stop or Continue?

### Stop for a regression PR now.

**Rationale:**

The view-model layer for all five PRs is well covered (labeling, disagree detection, timeline length, archetype probability ranking). However, there is a **critical untested path** introduced by PR 3: the `POST /api/sessions/:id/decision` endpoint with the `note` field, and the corresponding `GET` for reload, have **zero** integration test coverage. This is the first place where a regression would be both silent and user-visible (a reviewer's note disappearing on reload is a trust-breaking failure).

The React component layer (badge rendering, disagreement banner, state resets) is also zero-covered. While component tests can wait, the API persistence layer should not.

**Proposed regression PR (smallest safe scope):**

1. Add two integration-test cases to `tests/integration/live-session.test.ts` (or a new `tests/integration/reviewer-workflow.test.ts`):
   - POST a decision with a note; GET the decision; assert `note` round-trips correctly.
   - POST a decision without a note; GET the decision; assert `note` is absent/undefined.
2. Optionally add one analytics edge-case test:
   - `session_context=None` passed to `score_session` uses the default policy threshold.

This is a one-file (or two-file) change, fully within the existing test infrastructure, and should take under an hour to write and verify. It directly protects the new note-persistence feature before any further PR adds complexity on top of it.

**After the regression PR, continue with PR 6.** The broader component-layer regression (React rendering, state reset behavior) can be deferred to a post-PR-6 sweep, as it requires a testing framework not yet set up in this repo (e.g., Vitest + Testing Library).
