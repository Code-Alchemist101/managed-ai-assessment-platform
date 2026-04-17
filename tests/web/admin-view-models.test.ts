import test from "node:test";
import assert from "node:assert/strict";
import { buildRecentSessionRows } from "../../apps/admin-web/src/view-model";

test("admin inventory rows preserve mixed session states and reviewer links", () => {
  const rows = buildRecentSessionRows(
    [
      {
        id: "session-scored",
        manifest_id: "manifest-python-cli-live-desktop-ide",
        manifest_name: "Desktop + IDE Live",
        candidate_id: "desktop-live",
        created_at: "2026-04-12T09:00:00Z",
        updated_at: "2026-04-12T09:02:00Z",
        status: "scored",
        has_scoring: true,
        required_streams: ["desktop", "ide"],
        present_streams: ["desktop", "ide"],
        event_counts_by_source: { desktop: 5, ide: 12 },
        first_event_at: "2026-04-12T09:00:01Z",
        last_event_at: "2026-04-12T09:01:55Z",
        integrity_verdict: "clean",
        missing_streams: [],
        policy_recommendation: "human-review",
        invalidation_reasons: [],
        haci_score: 44.5,
        predicted_archetype: "Independent Solver",
        scoring_error: null
      },
      {
        id: "session-invalid",
        manifest_id: "manifest-python-cli-live-desktop-ide",
        manifest_name: "Desktop + IDE Live",
        candidate_id: "desktop-live",
        created_at: "2026-04-12T09:03:00Z",
        updated_at: "2026-04-12T09:04:00Z",
        status: "invalid",
        has_scoring: true,
        required_streams: ["desktop", "ide"],
        present_streams: ["desktop"],
        event_counts_by_source: { desktop: 4 },
        first_event_at: "2026-04-12T09:03:05Z",
        last_event_at: "2026-04-12T09:03:40Z",
        integrity_verdict: "invalid",
        missing_streams: ["ide"],
        policy_recommendation: "invalid-session",
        invalidation_reasons: ["missing_required_streams"],
        haci_score: 11,
        predicted_archetype: "Blind Copier",
        scoring_error: "Analytics service returned HTTP 500"
      }
    ],
    "http://127.0.0.1:4173"
  );

  assert.equal(rows.length, 2);
  assert.equal(rows[0].integrityVerdict, "clean");
  assert.equal(rows[0].statusLabel, "scored");
  assert.equal(rows[1].status, "invalid");
  assert.equal(rows[1].scoringError, "Analytics service returned HTTP 500");
  assert.equal(rows[1].missingStreams, "ide");
  assert.equal(rows[1].reviewerUrl, "http://127.0.0.1:4173?sessionId=session-invalid");
});
