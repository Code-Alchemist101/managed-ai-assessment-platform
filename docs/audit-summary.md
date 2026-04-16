# End-to-End Stability and Integrity Audit Summary

Audit performed after 10 merged PRs. Branch: `copilot/audit-end-to-end-testing`.

---

## Audit Scope

All major application surfaces were inspected and tested:

| Surface | Covered | Notes |
|---|---|---|
| Control-plane API | ✅ | All key endpoints; edge cases added |
| Analytics scoring pipeline | ✅ | All integrity flags; empty/null inputs; mode fallback |
| Reviewer web view-models | ✅ | Null-safety; fallback chains; all flags; scoring helpers |
| Admin web view-models | ✅ | Empty list; pending/null state; URL construction |
| Replay/demo flows | ✅ | Existing `demo-runner.test.ts` covers the happy path |
| Reviewer decision persistence | ✅ | Note overwrite; empty note; unknown session; bad body |
| Dual scoring display | ✅ | `scoringModesDisagree` for all null/present combinations |
| Manifest policy behavior | ✅ | `decision_policy` passthrough; override threshold tests |
| Short-session / low-info behavior | ✅ | All typing-only sparse signature tests maintained |
| Timeline behavior | ✅ | 15-event uncapped test; null eventsResponse |
| Note persistence | ✅ | Save/overwrite/empty-note edge cases |
| Empty and partial-data states | ✅ | No-events session; no-scoring session; null fields |

---

## New Tests Added

### Python analytics (`services/analytics-py/tests/test_pipeline.py`)

12 new tests in `EdgeCaseAndRegressionTests`:

- **`test_empty_events_list_raises_value_error`** — documents that `score_session` raises `ValueError` for empty events (known API limitation; see Risks below)
- **`test_none_session_context_produces_valid_scoring_output`** — `None` context must not crash
- **`test_invalid_archetype_mode_env_falls_back_to_heuristic`** — garbage `ARCHETYPE_MODE` env var falls back safely
- **`test_telemetry_heartbeat_missing_flag_when_desktop_has_no_heartbeat`** — `telemetry_heartbeat_missing` flag
- **`test_suspicious_bulk_paste_flag_triggered`** — `suspicious_bulk_paste` from `ide.clipboard.paste` ≥ 2000 chars
- **`test_unmanaged_tool_flag_raised_on_system_event`** — `unmanaged_tool_detected` flag
- **`test_tamper_signal_detected_makes_verdict_invalid`** — tamper → `invalid` verdict
- **`test_unmanaged_browser_flag_makes_verdict_invalid`** — unmanaged browser → `invalid` verdict
- **`test_unsupported_ai_provider_flag`** — disallowed provider → `unsupported_ai_provider` flag
- **`test_sequence_gap_detected_flag`** — out-of-order sequence numbers → `sequence_gap_detected` flag
- **`test_score_session_always_returns_heuristic_result_not_none`** — `heuristic_result` guaranteed non-null for non-empty events
- **`test_auto_reject_enabled_field_is_passed_through_in_context`** — `auto_reject_enabled` policy field accepted without error

### Control-plane API integration (`tests/integration/audit-edge-cases.test.ts`)

19 new tests covering:

- `POST /api/sessions` — missing `manifest_id`, missing `candidate_id`, empty body → 400
- `GET /api/sessions/:id` — unknown session → 404
- `GET /api/sessions/:id/scoring` — unscored session → 404
- `GET /api/sessions/:id` — no-events state returns null `integrity_verdict`, `haci_score`, `predicted_archetype`
- `GET /api/sessions/:id/decision` — unknown session → 404; no decision yet → 404
- `POST /api/sessions/:id/decision` — unknown session → 404; invalid body → 400; missing decision field → 400
- Decision note edge cases: empty-string note; overwrite with note removal; GET reflects final state
- `/api/runtime` — null IDs when no sessions; correct `latest_session_id` after creation; `latest_scored_session_id` remains null for unscored
- `POST /api/sessions/:id/status` — invalid status → non-200 (documents unhandled ZodError → 500, see Risks)
- `POST /api/manifests` — new manifest persisted and appears in GET list
- `GET /api/sessions` — ordering (newest-first)
- `GET /api/sessions/:id/events` — no events ingested → 404

### Reviewer/admin view-models (`tests/web/audit-view-models.test.ts`)

22 new tests covering:

- `resolvePreferredSessionId` — 5 fallback-chain scenarios (query ID → latest_scored → first → null)
- `buildCompletenessSummary` — null session; sorted source counts
- `buildSourceMix` — null; empty; sort order
- `buildTimelineEntries` — null
- `topFeatureLabels` — null; empty; negative contributions
- `buildIntegrityFlagLabels` — empty flags; all 12 known flags individually
- `scoringModesDisagree` — null `trained_model_result`; missing `heuristic_result`
- `buildRecentSessionRows` — empty list; pending/null-fields session; multiple missing streams; URL construction

---

## Uncovered Risks and Follow-up Bugs

### 1. `score_session` crashes on empty event list (Follow-up bug)
**Severity:** Medium  
**Surface:** Analytics service  
**Detail:** `extract_feature_vector` raises `ValueError: Cannot extract features from an empty event list.` when called with zero events. The control-plane's `/api/sessions/:id/score` endpoint would return a 502 rather than a meaningful 400/422 if events are missing at scoring time (currently protected by a separate `readSessionEvents` 404 guard, but the analytics HTTP layer is unprotected). If a session is scored via a direct analytics API call with empty events, the server returns an unhandled exception.  
**Recommendation:** Add graceful handling in `score_session` for empty event lists, returning an appropriate error or a minimal scoring result with `policy_recommendation: "invalid-session"`.

### 2. Invalid session status causes unhandled ZodError → 500 (Follow-up bug)
**Severity:** Low  
**Surface:** Control-plane API `/api/sessions/:id/status`  
**Detail:** Sending an invalid `status` value (e.g., `"not-a-valid-status"`) causes `SessionStatusSchema.parse` to throw a `ZodError` that bubbles up as an HTTP 500 instead of a 400. All other validation in the API uses `safeParse` or try/catch. This endpoint is an inconsistency.  
**Recommendation:** Wrap `SessionStatusSchema.parse` in a `safeParse` call and return 400 on validation failure.

### 3. Empty-string note is preserved in the decision payload (Minor inconsistency)
**Severity:** Low  
**Surface:** Control-plane API reviewer decision  
**Detail:** When `note: ""` is sent, the Zod schema's `.optional()` accepts an empty string and stores it. The GET response then returns `note: ""`. This is technically valid but may appear as a blank note field in the reviewer UI rather than showing the field as absent.  
**Recommendation:** Add a `.transform` or `.refine` to strip empty strings from the note field before persistence, or treat it as absent in the view-model layer.

### 4. Analytics HTTP endpoint lacks input validation for empty events (Follow-up)
**Severity:** Medium  
**Surface:** Analytics FastAPI (`POST /score-session`)  
**Detail:** The analytics HTTP endpoint passes events directly to `score_session`, which will raise for empty events. The FastAPI error handler should catch this and return a 422 rather than a 500.

---

## Manual Verification Checklist

The following scenarios cannot be practically automated without a real browser/Electron environment:

- [ ] **Reviewer UI session switching**: Load reviewer UI with multiple sessions; switch between sessions; verify no stale scoring data persists in the panel.
- [ ] **Reviewer UI dual-mode disagreement banner**: When `heuristic_result` and `trained_model_result` predict different archetypes, verify the disagreement banner is visible and clear.
- [ ] **Reviewer UI interpretation copy**: Verify the HACI band description, scoring mode description, and integrity verdict description render correctly under each condition (high/medium/low band; clean/review/invalid verdict).
- [ ] **Admin UI governance section**: Verify no static placeholder governance checklist items remain after the earlier admin-surface PR (PR removing misleading placeholders).
- [ ] **Admin UI pending session row**: Verify the admin table row for a `created`/`active` session shows `"pending"` for integrity verdict and `"no"` for has_scoring without displaying null or undefined.
- [ ] **Page reload persistence**: After saving a reviewer decision, reload the page and verify the decision and note are restored correctly.
- [ ] **Timeline scrollability**: Verify sessions with more than 10 events display all events in the timeline (no 10-event cap regression).
- [ ] **Short session warning**: Verify the `low_information_session` integrity flag displays the human-readable description ("Too few events for reliable scoring") prominently when the session has the sparse signature.
- [ ] **Manifest override policy**: Verify that a session scored under a manifest with `auto_advance_min_confidence: 0.1` (overridden lower) correctly shows `policy_recommendation: "auto-advance"` when confidence is above that threshold and integrity is clean.

---

## What Is Well-Covered by Existing Tests

- Happy-path demo replay (creates session, ingests fixture, scores, returns result)
- Reviewer decision save/overwrite/note persistence (demo-runner.test.ts)
- Live desktop+IDE clean session end-to-end
- Live desktop-only invalid session (missing IDE stream)
- Full live manifest with browser telemetry
- All 21 analytics pipeline tests including: feature extraction, integrity evaluation, heuristic/trained-model scoring modes, policy threshold tests, HACI stability, short-session bias documentation
- All reviewer view-model helpers including: timeline rendering, probability ranking, source mix, flag labels, HACI descriptions, scoring mode descriptions, integrity verdict descriptions, confidence labels
- Desktop-controller session-helper logic
- Edge extension bootstrap helpers

---

## Test Count Summary

| Suite | Before audit | After audit |
|---|---|---|
| `test:analytics` (Python) | 21 | 33 |
| `test:web` (TypeScript) | 32 | 54 |
| `test:integration` (TypeScript) | 2 | 21 |
| **Total** | **55** | **108** |
