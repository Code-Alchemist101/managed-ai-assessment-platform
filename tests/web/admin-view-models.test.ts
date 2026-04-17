import test from "node:test";
import assert from "node:assert/strict";
import { buildRecentSessionRows } from "../../apps/admin-web/src/view-model";
import type { SessionDetail } from "@assessment-platform/contracts";

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
        predicted_archetype: "Independent Solver"
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
        predicted_archetype: "Blind Copier"
      }
    ],
    "http://127.0.0.1:4173"
  );

  assert.equal(rows.length, 2);
  assert.equal(rows[0].integrityVerdict, "clean");
  assert.equal(rows[1].status, "invalid");
  assert.equal(rows[1].missingStreams, "ide");
  assert.equal(rows[1].reviewerUrl, "http://127.0.0.1:4173?sessionId=session-invalid");
});

// ---------------------------------------------------------------------------
// Edge-case and partial-data hardening
// ---------------------------------------------------------------------------

test("buildRecentSessionRows returns an empty array for an empty sessions list", () => {
  const rows = buildRecentSessionRows([], "http://127.0.0.1:4173");
  assert.deepEqual(rows, []);
});

test("buildRecentSessionRows handles unscored session with null scoring fields", () => {
  const unscoredSession: SessionDetail = {
    id: "session-unscored",
    manifest_id: "manifest-python-cli",
    manifest_name: "Python CLI Assessment",
    candidate_id: "candidate-a",
    created_at: "2026-04-15T10:00:00Z",
    updated_at: "2026-04-15T10:00:01Z",
    status: "created",
    has_scoring: false,
    required_streams: ["desktop", "ide"],
    present_streams: [],
    event_counts_by_source: {},
    first_event_at: null,
    last_event_at: null,
    integrity_verdict: null,
    missing_streams: [],
    policy_recommendation: null,
    invalidation_reasons: [],
    haci_score: null,
    predicted_archetype: null
  };

  const rows = buildRecentSessionRows([unscoredSession], "http://127.0.0.1:4173");
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row.id, "session-unscored");
  assert.equal(row.status, "created");
  assert.equal(row.hasScoring, "no");
  // Null integrity_verdict should surface as "pending" in the row.
  assert.equal(row.integrityVerdict, "pending");
  assert.equal(row.missingStreams, "None");
  assert.equal(row.reviewerUrl, "http://127.0.0.1:4173?sessionId=session-unscored");
});

test("buildRecentSessionRows shows correct manifestLabel combining manifest_name and manifest_id", () => {
  const session: SessionDetail = {
    id: "session-label",
    manifest_id: "manifest-python-cli",
    manifest_name: "Python CLI Assessment",
    candidate_id: "candidate-b",
    created_at: "2026-04-15T10:00:00Z",
    updated_at: "2026-04-15T10:00:01Z",
    status: "scored",
    has_scoring: true,
    required_streams: ["desktop", "ide"],
    present_streams: ["desktop", "ide"],
    event_counts_by_source: { desktop: 3, ide: 5 },
    first_event_at: "2026-04-15T10:00:05Z",
    last_event_at: "2026-04-15T10:01:00Z",
    integrity_verdict: "clean",
    missing_streams: [],
    policy_recommendation: "auto-advance",
    invalidation_reasons: [],
    haci_score: 75.0,
    predicted_archetype: "Independent Solver"
  };

  const rows = buildRecentSessionRows([session], "http://127.0.0.1:4173");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].manifestLabel, "Python CLI Assessment (manifest-python-cli)");
});

test("buildRecentSessionRows correctly renders a session with multiple missing streams", () => {
  const session: SessionDetail = {
    id: "session-missing-multi",
    manifest_id: "manifest-python-cli-live-full",
    manifest_name: "Python CLI Full",
    candidate_id: "candidate-c",
    created_at: "2026-04-15T10:00:00Z",
    updated_at: "2026-04-15T10:00:01Z",
    status: "invalid",
    has_scoring: true,
    required_streams: ["desktop", "ide", "browser"],
    present_streams: ["desktop"],
    event_counts_by_source: { desktop: 2 },
    first_event_at: "2026-04-15T10:00:02Z",
    last_event_at: "2026-04-15T10:00:10Z",
    integrity_verdict: "invalid",
    missing_streams: ["browser", "ide"],
    policy_recommendation: "invalid-session",
    invalidation_reasons: ["missing_required_streams"],
    haci_score: 5,
    predicted_archetype: "Blind Copier"
  };

  const rows = buildRecentSessionRows([session], "http://127.0.0.1:4173");
  assert.equal(rows.length, 1);
  // Both missing streams should appear in the output.
  assert.ok(rows[0].missingStreams.includes("browser"));
  assert.ok(rows[0].missingStreams.includes("ide"));
});
