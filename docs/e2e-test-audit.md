# E2E Test Audit — Post-10-PR Hardening

_Branch: `copilot/e2e-test-matrix-coverage`_

---

## 1. Coverage Summary

### Well-Covered (existing tests)

| Area | Tests | Location |
|------|-------|----------|
| Demo replay fixture (full flow) | Happy path, fixture resequencing, scoring persisted | `tests/integration/demo-runner.test.ts` |
| Reviewer decision persistence | Note save/overwrite/clear round-trip | `tests/integration/demo-runner.test.ts` |
| Live session scoring (desktop+ide) | Clean, missing-ide invalid | `tests/integration/live-session.test.ts` |
| Full manifest (browser stream) | Bootstrap, browser nav, clean scoring | `tests/integration/live-session.test.ts` |
| Short / low-information sessions | Sparse signature, flag, bias doc, always-review policy | `services/analytics-py/tests/test_pipeline.py` |
| Integrity: stream detection | Required streams, managed-bootstrap nav, unsupported site | `services/analytics-py/tests/test_pipeline.py` |
| Dual-mode scoring output | heuristic_result always present, trained_model_result when artifacts load, fallback | `services/analytics-py/tests/test_pipeline.py` |
| Manifest decision policy override | Threshold lower/higher than fixture confidence | `services/analytics-py/tests/test_pipeline.py` |
| HACI stable across modes | Same score regardless of ARCHETYPE_MODE | `services/analytics-py/tests/test_pipeline.py` |
| View models: scoring display | Timeline, source mix, feature labels, archetype probs, confidence label | `tests/web/view-models.test.ts` |
| View models: dual scoring | `scoringModesDisagree`, disagreement detection | `tests/web/view-models.test.ts` |
| View models: interpretation help | HACI band desc, scoring mode desc, integrity verdict desc | `tests/web/view-models.test.ts` |
| View models: integrity flags | `low_information_session` label, unknown-flag fallback | `tests/web/view-models.test.ts` |
| View models: session selection | `resolvePreferredSessionId` with direct query ID | `tests/web/view-models.test.ts` |
| Timeline > 10 events | 15-event set returned uncapped | `tests/web/view-models.test.ts` |
| Admin row building | Mixed scored/invalid states, reviewer URL formation | `tests/web/admin-view-models.test.ts` |

---

### Newly Added Tests (this PR)

| Area | What Was Missing | Added In |
|------|------------------|----------|
| Control-plane 404 paths | Unknown session, no scoring yet, no events, no decision, unknown session for decision POST, unknown bootstrap | `tests/integration/regression-hardening.test.ts` |
| Control-plane 400 validation | Missing `manifest_id`/`candidate_id`, invalid decision value, missing `status` field | `tests/integration/regression-hardening.test.ts` |
| Decision overwrite edge cases | Note-to-no-note round-trip, empty string note acceptance | `tests/integration/regression-hardening.test.ts` |
| Runtime config correctness | Null state before sessions, `latest_session_id` updates, `latest_scored_session_id` vs unscored sesison | `tests/integration/regression-hardening.test.ts` |
| Score endpoint without events | 404 when no events ingested before scoring | `tests/integration/regression-hardening.test.ts` |
| Manifest registration | POST + GET round-trip | `tests/integration/regression-hardening.test.ts` |
| Demo replay with explicit manifest_id | Correct manifest used, unknown manifest → 404 | `tests/integration/regression-hardening.test.ts` |
| Session detail — partial-data state | Null scoring fields on unscored session | `tests/integration/regression-hardening.test.ts` |
| Status transition edge cases | Unknown session → 404, missing status → 400 | `tests/integration/regression-hardening.test.ts` |
| Full flow + decision | Score → retrieve scoring → record decision → reload decision | `tests/integration/regression-hardening.test.ts` |
| Manifest policy propagation | Permissive custom manifest triggers auto-advance | `tests/integration/regression-hardening.test.ts` |
| Integrity: empty events | All streams missing, verdict=invalid | `services/analytics-py/tests/test_integrity_edge_cases.py` |
| Integrity: empty with no requirements | Clean verdict for no-required-streams empty session | `services/analytics-py/tests/test_integrity_edge_cases.py` |
| Integrity: tamper signal → invalid | `tamper_signal_detected` yields invalid verdict | `services/analytics-py/tests/test_integrity_edge_cases.py` |
| Integrity: unmanaged browser → invalid | `unmanaged_browser_detected` yields invalid verdict | `services/analytics-py/tests/test_integrity_edge_cases.py` |
| Integrity: unmanaged tool → review | `unmanaged_tool_detected` is review, not invalid | `services/analytics-py/tests/test_integrity_edge_cases.py` |
| Integrity: sequence gap detection | Non-contiguous sequence numbers flag `sequence_gap_detected` | `services/analytics-py/tests/test_integrity_edge_cases.py` |
| Integrity: no gap on contiguous events | Contiguous sequence produces no flag | `services/analytics-py/tests/test_integrity_edge_cases.py` |
| Integrity: suspicious bulk paste | 2000-char paste triggers flag | `services/analytics-py/tests/test_integrity_edge_cases.py` |
| Integrity: small paste not flagged | <2000 chars doesn't trigger flag | `services/analytics-py/tests/test_integrity_edge_cases.py` |
| Integrity: excessive focus switching | 30 events trigger flag | `services/analytics-py/tests/test_integrity_edge_cases.py` |
| Integrity: unsupported AI provider | Blocked provider raises flag | `services/analytics-py/tests/test_integrity_edge_cases.py` |
| Integrity: allowed AI provider not flagged | Whitelisted provider passes cleanly | `services/analytics-py/tests/test_integrity_edge_cases.py` |
| Integrity: unsupported site (domain lookup) | Unknown domain + `allowed_site=None` flags visit | `services/analytics-py/tests/test_integrity_edge_cases.py` |
| Integrity: multiple review flags → review | Accumulated non-invalidating flags stay at review | `services/analytics-py/tests/test_integrity_edge_cases.py` |
| Scoring output shape | All 15 required keys present | `services/analytics-py/tests/test_integrity_edge_cases.py` |
| HACI clamping | Score in [0, 100] | `services/analytics-py/tests/test_integrity_edge_cases.py` |
| HACI band consistency | Band matches score thresholds | `services/analytics-py/tests/test_integrity_edge_cases.py` |
| Heuristic result shape | Well-formed, probabilities sum to 1 | `services/analytics-py/tests/test_integrity_edge_cases.py` |
| Minimal payload events | Single event with empty payload doesn't crash | `services/analytics-py/tests/test_integrity_edge_cases.py` |
| Decision policy: confidence > threshold | auto-advance fires | `services/analytics-py/tests/test_integrity_edge_cases.py` |
| Decision policy: confidence < threshold | human-review | `services/analytics-py/tests/test_integrity_edge_cases.py` |
| Decision policy: invalid integrity overrides | invalid-session even with 0.01 threshold | `services/analytics-py/tests/test_integrity_edge_cases.py` |
| Admin: empty sessions list | `buildRecentSessionRows([])` → `[]` | `tests/web/admin-view-models.test.ts` |
| Admin: unscored session | `has_scoring=false`, `integrity_verdict=null` → "pending", "no" | `tests/web/admin-view-models.test.ts` |
| Admin: manifest label format | `name (id)` format confirmed | `tests/web/admin-view-models.test.ts` |
| Admin: multiple missing streams | Both streams appear in `missingStreams` | `tests/web/admin-view-models.test.ts` |
| Reviewer: null timeline | `buildTimelineEntries(null)` → `[]` | `tests/web/view-models.test.ts` |
| Reviewer: empty timeline | Empty events array → `[]` | `tests/web/view-models.test.ts` |
| Reviewer: null eventCount | `eventCount(null)` → `0` | `tests/web/view-models.test.ts` |
| Reviewer: null sourceMix | `buildSourceMix(null)` → `[]` | `tests/web/view-models.test.ts` |
| Reviewer: empty sourceMix | Empty events → `[]` | `tests/web/view-models.test.ts` |
| Reviewer: null completeness | `buildCompletenessSummary(null)` → all empty | `tests/web/view-models.test.ts` |
| Reviewer: null topFeatures | `topFeatureLabels(null)` → `[]` | `tests/web/view-models.test.ts` |
| Reviewer: resolvePreferred — empty list | Returns null | `tests/web/view-models.test.ts` |
| Reviewer: resolvePreferred — stale query ID | Falls back to `latest_scored_session_id` | `tests/web/view-models.test.ts` |
| Reviewer: resolvePreferred — null latest scored | Falls back to first session | `tests/web/view-models.test.ts` |
| Reviewer: scoringModesDisagree — null trained | Returns false | `tests/web/view-models.test.ts` |
| Reviewer: all known integrity flag labels | Each flag produces a description + `(flagName)` | `tests/web/view-models.test.ts` |

---

## 2. E2E Test Matrix (by Surface)

### Control-Plane API

| Scenario | Happy path | Regression risk | Edge / adversarial | Coverage |
|----------|------------|-----------------|-------------------|----------|
| Session create | ✓ demo replay, live-session | Missing `manifest_id`/`candidate_id` → 400 | **NEW**: validates both 400 paths | ✅ |
| Session detail | ✓ enriched detail test | Null scoring fields on unscored session mislead UI | **NEW**: null fields confirmed | ✅ |
| Session events | ✓ events returned | No events ingested → 404 | **NEW**: 404 path confirmed | ✅ |
| Session scoring | ✓ scoring retrieved | Scoring not yet produced → 404 | **NEW**: 404 path confirmed | ✅ |
| Session score endpoint | ✓ happy path | No events ingested → wrong error code | **NEW**: 404 confirmed | ✅ |
| Reviewer decision | ✓ note save/reload | Note cleared on overwrite; empty note | **NEW**: overwrite, empty-note | ✅ |
| Decision GET before save | — | Returns 404 silently or 500 | **NEW**: 404 confirmed | ✅ |
| Runtime config | — | `latest_scored_session_id` stale or wrong | **NEW**: null→set→after-unscored | ✅ |
| Manifest register | ✓ list returned | Custom manifest lost after restart | **NEW**: POST→GET round-trip | ✅ |
| Demo replay (explicit manifest) | — | Wrong manifest used | **NEW**: explicit manifest_id test | ✅ |
| Policy propagation | ✓ threshold test | Permissive manifest not respected | **NEW**: custom 0.01 threshold | ✅ |
| Unknown session endpoints | — | 500 instead of 404 | **NEW**: all 404 paths | ✅ |
| Bootstrap page | ✓ live-session | Unknown session → 404 | **NEW**: 404 confirmed | ✅ |

### Analytics Scoring Pipeline

| Scenario | Happy path | Regression risk | Edge / adversarial | Coverage |
|----------|------------|-----------------|-------------------|----------|
| Score from fixture | ✓ | Signal count regression | Existing | ✅ |
| Empty event list | — | Crash / wrong verdict | **NEW**: invalid with all missing | ✅ |
| Tamper signal | — | Review instead of invalid | **NEW**: confirmed invalid | ✅ |
| Unmanaged browser | — | Review instead of invalid | **NEW**: confirmed invalid | ✅ |
| Sequence gap | — | Flag not raised | **NEW**: confirmed | ✅ |
| Suspicious bulk paste | — | Flag not raised | **NEW**: 2000-char boundary | ✅ |
| Excessive focus switching | — | Flag not raised | **NEW**: 30-switch boundary | ✅ |
| Unsupported AI provider | ✓ | Allowed provider flagged (regression) | **NEW**: allowed vs blocked | ✅ |
| Unsupported site | ✓ | allowed_site=None edge case | **NEW**: domain lookup path | ✅ |
| Multiple review flags | — | Mistakenly escalated to invalid | **NEW**: stays at review | ✅ |
| HACI score clamping | — | Score outside [0, 100] | **NEW**: clamped assertion | ✅ |
| Decision policy boundary | ✓ lower/higher | Off-by-one at exact threshold | **NEW**: at-threshold | ✅ |
| Invalid integrity overrides policy | — | auto-advance on invalid session | **NEW**: override confirmed | ✅ |
| Minimal payload (no crash) | — | KeyError on empty payload | **NEW**: graceful | ✅ |

### Reviewer Web View Models

| Scenario | Happy path | Regression risk | Edge / adversarial | Coverage |
|----------|------------|-----------------|-------------------|----------|
| Timeline rendering | ✓ | Past 10-event cap regression | Existing cap test | ✅ |
| Null/empty timeline | — | Crash on null | **NEW**: explicit | ✅ |
| Source mix | ✓ | Null crash | **NEW**: null/empty | ✅ |
| Completeness summary | ✓ | Null session crash | **NEW**: null path | ✅ |
| Archetype probs | ✓ | Null crash | Existing null test | ✅ |
| Confidence label | ✓ | Wrong label for heuristic/trained | Existing | ✅ |
| Scoring mode disagree | ✓ | False positive when trained=null | **NEW**: null trained | ✅ |
| Session selection fallback | ✓ direct ID | Stale query ID shows wrong session | **NEW**: fallback chain | ✅ |
| All integrity flag labels | ✓ low_info | Unknown flag, other known flags unlabeled | **NEW**: all 8 known flags | ✅ |

### Admin Web View Models

| Scenario | Happy path | Regression risk | Edge / adversarial | Coverage |
|----------|------------|-----------------|-------------------|----------|
| Mixed session rows | ✓ | — | Existing | ✅ |
| Empty sessions list | — | Crash | **NEW**: `[]` | ✅ |
| Unscored session (null integrity) | — | Null shown as "null" in UI | **NEW**: "pending" | ✅ |
| Multiple missing streams | — | Only first stream shown | **NEW**: both streams | ✅ |
| Manifest label format | — | Wrong format | **NEW**: confirmed | ✅ |

---

## 3. Open Risks and Follow-Up Bugs

The following are **potential bugs or design concerns** identified during this audit. They are noted here as follow-up PRs — **not fixed in this PR** (test-only change).

### FUP-1: `SessionScoringPayloadSchema` strips `scoring_mode` from analytics output
- **Risk**: The analytics service returns `scoring_mode` in the top-level response, but `SessionScoringPayloadSchema` in contracts does not have a matching `z.literal()` guard tied to the active mode. The schema does include `scoring_mode: z.enum(["heuristic", "trained_model"])` so this is parsed correctly, but the top-level `ScoringResultSchema` and the sub-result schemas use different field types. Worth verifying round-trip.
- **Impact**: Low — both schemas parse, but inconsistency is a future maintenance risk.

### FUP-2: `tryReadScoring` silently returns `null` on any Zod or IO error
- **Risk**: If a scoring file is corrupted or partially written (e.g., process crash during `writeJson`), `tryReadScoring` returns `null` and `buildSessionDetail` shows a session as "unscored". The reviewer sees "pending" state for a session that actually has data.
- **Impact**: Medium — misleading reviewer/admin state; no error surfaced.

### FUP-3: `resequenceEvents` in demo replay overwrites original sequence numbers
- **Risk**: Fixture events are renumbered starting from 1 per source, which means the replayed sequence always appears "clean". This hides whether the fixture itself contains sequence gaps.
- **Impact**: Low — current design choice, but reduces fixture value for regression testing of gap detection.

### FUP-4: `buildSessionDetail` uses manifest's `required_streams` before scoring, but scoring's `missing_streams` after
- **Risk**: If a manifest's `required_streams` changes after a session is scored, the pre-scoring detail and post-scoring detail can disagree about what streams are "required" vs. "missing".
- **Impact**: Low — operational environment; manifests should not change after session creation.

### FUP-5: Reviewer decision GET returns 404 for unknown session (no distinction between "session exists, no decision" vs "session unknown")
- **Risk**: Both cases currently return 404. A UI treating 404 as "no decision yet" will silently succeed for unknown session IDs. This is tested and confirmed — but worth noting as a UX concern.
- **Impact**: Low — acceptable for current UI, but worth adding a distinct error message or HTTP status if the two cases need separate handling.

### FUP-6: Analytics service returning a 5xx causes the session to remain in "submitted" status
- **Risk**: If `scoreSession()` returns a 502 error, the session status is not updated and stays at "submitted". The session detail would show `has_scoring: false` but `status: "submitted"` — a stale state that reviewers cannot act on.
- **Impact**: Medium — no retry mechanism; admin would need to manually re-trigger scoring.

---

## 4. Manual Verification Checklist

These items are impractical to automate in the current repo setup:

### Reviewer Web UI
- [ ] Open reviewer at `http://127.0.0.1:4173` with a scored session. Verify HACI band description renders below the score (not just raw number).
- [ ] With a session where `trained_model_result` is absent (heuristic mode only), confirm the "scoring mode" panel shows only the heuristic card and the disagreement banner is not shown.
- [ ] With a session where both modes disagree (`heuristic_result.predicted_archetype ≠ trained_model_result.predicted_archetype`), confirm the disagreement banner appears and names both archetypes.
- [ ] Submit a reviewer decision with a long note (> 500 chars). Verify it saves and reloads correctly.
- [ ] Submit a reviewer decision, reload the page (browser refresh), and confirm the decision and note persist.
- [ ] Switch between two sessions using the session selector. Verify the UI updates all panels (scoring, timeline, completeness) without stale data from the previous session.
- [ ] Open a session that has `integrity_verdict: "review"` and verify all flag labels are shown with their human-readable descriptions.
- [ ] Open a session that has `integrity_verdict: "invalid"` and verify the UI clearly blocks reviewer from marking it "approve".

### Admin Web UI
- [ ] Open admin at `http://127.0.0.1:4174` with a mix of scored, invalid, and unscored sessions. Verify each row shows the correct status, integrity badge, and reviewer link.
- [ ] Verify that an unscored session row shows "pending" for integrity (not "null" or blank).
- [ ] Confirm no governance/checklist UI elements remain that claim functionality not yet implemented.

### Replay / Demo Flow
- [ ] Run `npm run demo:local` and confirm the replay completes with `status: "scored"`.
- [ ] Run `npm run session:report:latest` and verify the output matches the most-recently-scored session.
- [ ] Run `npm run session:report:latest:json` and confirm `scoring.heuristic_result` is present in the output.

### Analytics Pipeline
- [ ] With `ARCHETYPE_MODE=trained_model` set, run the demo replay and confirm `scoring.trained_model_result` is non-null and the top-level `scoring_mode` is `"trained_model"`.
- [ ] Remove or rename the `services/analytics-py/artifacts/archetype_xgboost.pkl` file and re-run the replay. Confirm `trained_model_result` is `null` and the top-level mode falls back to `"heuristic"` without crashing.

### Integration / Runtime Scripts
- [ ] Run `npm run dev:stack:smoke` and confirm all services start and the health endpoints return 200.
- [ ] Run `npm run test:integration` to completion and confirm all integration tests pass in the CI environment.
