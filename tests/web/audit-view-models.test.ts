/**
 * Audit edge-case tests for reviewer and admin view-model helpers.
 *
 * Covers:
 *  - resolvePreferredSessionId fallback chain with multiple sessions
 *  - buildCompletenessSummary with null session
 *  - buildSourceMix with null eventsResponse
 *  - buildTimelineEntries with null eventsResponse
 *  - topFeatureLabels with null and zero-feature scoring
 *  - Admin buildRecentSessionRows with empty session list and pending/unscored state
 *  - buildIntegrityFlagLabels with empty flags and all known flags
 *  - scoringModesDisagree edge cases: null trained_model_result, same archetypes
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCompletenessSummary,
  buildIntegrityFlagLabels,
  buildSourceMix,
  buildTimelineEntries,
  resolvePreferredSessionId,
  scoringModesDisagree,
  topFeatureLabels
} from "../../apps/reviewer-web/src/view-model";
import { buildRecentSessionRows } from "../../apps/admin-web/src/view-model";
import type { LocalRuntimeConfig, SessionDetail } from "@assessment-platform/contracts";

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

const baseRuntime: LocalRuntimeConfig = {
  control_plane_url: "http://127.0.0.1:4010",
  ingestion_url: "http://127.0.0.1:4020/api/events",
  analytics_url: "http://127.0.0.1:4030",
  reviewer_url: "http://127.0.0.1:4173",
  admin_url: "http://127.0.0.1:4174",
  assessment_data_dir: "/tmp/test",
  latest_session_id: null,
  latest_scored_session_id: null
};

function makeSession(overrides: Partial<SessionDetail> = {}): SessionDetail {
  return {
    id: "session-a",
    manifest_id: "manifest-python-cli",
    manifest_name: "Python CLI Assessment",
    candidate_id: "test-candidate",
    created_at: "2026-04-14T10:00:00Z",
    updated_at: "2026-04-14T10:01:00Z",
    status: "scored",
    has_scoring: true,
    required_streams: ["desktop", "ide"],
    present_streams: ["desktop", "ide"],
    event_counts_by_source: { desktop: 5, ide: 8 },
    first_event_at: "2026-04-14T10:00:01Z",
    last_event_at: "2026-04-14T10:00:59Z",
    integrity_verdict: "clean",
    missing_streams: [],
    policy_recommendation: "human-review",
    invalidation_reasons: [],
    haci_score: 55,
    predicted_archetype: "Structured Collaborator",
    ...overrides
  };
}

function makeScoringBase() {
  return {
    session_id: "session-audit",
    model_version: "bootstrap-centroid-v1",
    scoring_mode: "heuristic" as const,
    haci_score: 50,
    haci_band: "medium" as const,
    predicted_archetype: "Structured Collaborator" as const,
    archetype_probabilities: {
      "Structured Collaborator": 0.5,
      "Exploratory Learner": 0.3,
      "Independent Solver": 0.2
    },
    confidence: 0.5,
    top_features: [],
    integrity: {
      verdict: "clean" as const,
      flags: [],
      required_streams_present: ["desktop", "ide"],
      missing_streams: [],
      notes: []
    },
    policy_recommendation: "human-review" as const,
    review_required: true,
    feature_vector: {
      session_id: "session-audit",
      extraction_version: "0.1.0",
      generated_at: "2026-04-14T10:10:00Z",
      signal_values: {},
      signals: [],
      completeness: "complete" as const,
      invalidation_reasons: []
    }
  };
}

// ---------------------------------------------------------------------------
// resolvePreferredSessionId – fallback chain
// ---------------------------------------------------------------------------

test("resolvePreferredSessionId: query ID takes priority when it matches a session", () => {
  const sessions = [makeSession({ id: "session-a" }), makeSession({ id: "session-b" })];
  const runtime = { ...baseRuntime, latest_scored_session_id: "session-b", latest_session_id: "session-b" };

  const result = resolvePreferredSessionId("session-a", runtime, sessions);
  assert.equal(result, "session-a", "direct query ID match must take priority");
});

test("resolvePreferredSessionId: falls back to latest_scored_session_id when query ID not matched", () => {
  const sessions = [makeSession({ id: "session-a" }), makeSession({ id: "session-b" })];
  const runtime = { ...baseRuntime, latest_scored_session_id: "session-b", latest_session_id: "session-a" };

  const result = resolvePreferredSessionId("unknown-session", runtime, sessions);
  assert.equal(result, "session-b", "stale/unknown query ID must fall back to latest_scored_session_id");
});

test("resolvePreferredSessionId: falls back to first session when latest_scored_session_id not in list", () => {
  const sessions = [makeSession({ id: "session-a" }), makeSession({ id: "session-b" })];
  const runtime = { ...baseRuntime, latest_scored_session_id: "stale-session-not-in-list", latest_session_id: null };

  const result = resolvePreferredSessionId(null, runtime, sessions);
  assert.equal(result, "session-a", "first session must be selected as final fallback");
});

test("resolvePreferredSessionId: returns null when session list is empty", () => {
  const result = resolvePreferredSessionId(null, baseRuntime, []);
  assert.equal(result, null, "null must be returned when there are no sessions");
});

test("resolvePreferredSessionId: null query ID skips query-ID match step", () => {
  const sessions = [makeSession({ id: "session-a" })];
  const runtime = { ...baseRuntime, latest_scored_session_id: "session-a", latest_session_id: "session-a" };

  // Null query param should not match and should fall through to latest_scored_session_id.
  const result = resolvePreferredSessionId(null, runtime, sessions);
  assert.equal(result, "session-a");
});

// ---------------------------------------------------------------------------
// buildCompletenessSummary – null session
// ---------------------------------------------------------------------------

test("buildCompletenessSummary returns empty defaults for null session", () => {
  const summary = buildCompletenessSummary(null);
  assert.deepEqual(summary.requiredStreams, []);
  assert.deepEqual(summary.presentStreams, []);
  assert.deepEqual(summary.missingStreams, []);
  assert.deepEqual(summary.invalidationReasons, []);
  assert.deepEqual(summary.sourceCounts, []);
});

test("buildCompletenessSummary returns sorted source counts descending", () => {
  const session = makeSession({
    event_counts_by_source: { ide: 10, desktop: 4, browser: 7 }
  });
  const summary = buildCompletenessSummary(session);
  assert.equal(summary.sourceCounts[0].source, "ide");
  assert.equal(summary.sourceCounts[0].count, 10);
  assert.equal(summary.sourceCounts[1].source, "browser");
  assert.equal(summary.sourceCounts[1].count, 7);
});

// ---------------------------------------------------------------------------
// buildSourceMix – null and empty
// ---------------------------------------------------------------------------

test("buildSourceMix returns empty array for null eventsResponse", () => {
  assert.deepEqual(buildSourceMix(null), []);
});

test("buildSourceMix returns empty array when events list is empty", () => {
  assert.deepEqual(buildSourceMix({ session_id: "s", events: [] }), []);
});

test("buildSourceMix sorts by count descending", () => {
  const mix = buildSourceMix({
    session_id: "s",
    events: [
      { source: "ide", event_type: "a", timestamp_utc: "2026-04-14T10:00:00Z", artifact_ref: "f", payload: {} },
      { source: "ide", event_type: "b", timestamp_utc: "2026-04-14T10:00:01Z", artifact_ref: "f", payload: {} },
      { source: "desktop", event_type: "c", timestamp_utc: "2026-04-14T10:00:02Z", artifact_ref: "s", payload: {} }
    ]
  });
  assert.equal(mix[0].source, "ide");
  assert.equal(mix[0].count, 2);
  assert.equal(mix[1].source, "desktop");
  assert.equal(mix[1].count, 1);
});

// ---------------------------------------------------------------------------
// buildTimelineEntries – null
// ---------------------------------------------------------------------------

test("buildTimelineEntries returns empty array for null eventsResponse", () => {
  assert.deepEqual(buildTimelineEntries(null), []);
});

// ---------------------------------------------------------------------------
// topFeatureLabels – null and empty
// ---------------------------------------------------------------------------

test("topFeatureLabels returns empty array for null scoring", () => {
  assert.deepEqual(topFeatureLabels(null), []);
});

test("topFeatureLabels returns empty array when top_features is empty", () => {
  const scoring = makeScoringBase();
  assert.deepEqual(topFeatureLabels(scoring), []);
});

test("topFeatureLabels formats negative contributions correctly", () => {
  const scoring = {
    ...makeScoringBase(),
    top_features: [
      { name: "max_paste_length" as const, contribution: -0.2 },
      { name: "typing_vs_paste_ratio" as const, contribution: 0.15 }
    ]
  };
  const labels = topFeatureLabels(scoring);
  assert.equal(labels.length, 2);
  assert.match(labels[0], /max_paste_length.*-0\.200/);
  assert.match(labels[1], /typing_vs_paste_ratio.*0\.150/);
});

// ---------------------------------------------------------------------------
// buildIntegrityFlagLabels – all known flags and empty flags
// ---------------------------------------------------------------------------

test("buildIntegrityFlagLabels returns empty array when flags list is empty", () => {
  const scoring = makeScoringBase();
  assert.deepEqual(buildIntegrityFlagLabels(scoring), []);
});

test("buildIntegrityFlagLabels renders all known integrity flags", () => {
  const knownFlags = [
    "missing_required_streams",
    "unsupported_ai_provider",
    "unsupported_site_visited",
    "unmanaged_tool_detected",
    "tamper_signal_detected",
    "sequence_gap_detected",
    "telemetry_heartbeat_missing",
    "suspicious_bulk_paste",
    "excessive_focus_switching",
    "excessive_idle_time",
    "unmanaged_browser_detected",
    "low_information_session"
  ] as const;

  for (const flag of knownFlags) {
    const scoring = {
      ...makeScoringBase(),
      integrity: { ...makeScoringBase().integrity, flags: [flag] }
    };
    const labels = buildIntegrityFlagLabels(scoring);
    assert.equal(labels.length, 1, `expected 1 label for flag: ${flag}`);
    // Must include the raw flag name in parentheses.
    assert.match(labels[0], new RegExp(`\\(${flag}\\)`), `label for ${flag} must include raw flag name`);
    // Must not be just the raw flag; must include a human description.
    assert.ok(
      labels[0].length > flag.length + 4,
      `label for ${flag} must be longer than just the flag name`
    );
  }
});

// ---------------------------------------------------------------------------
// scoringModesDisagree – additional edge cases
// ---------------------------------------------------------------------------

test("scoringModesDisagree returns false when trained_model_result is null", () => {
  const scoring = { ...makeScoringBase(), heuristic_result: undefined, trained_model_result: null };
  assert.equal(scoringModesDisagree(scoring), false);
});

test("scoringModesDisagree returns false when only trained_model_result is present (no heuristic_result)", () => {
  const scoring = {
    ...makeScoringBase(),
    trained_model_result: {
      scoring_mode: "trained_model" as const,
      model_version: "xgboost-research-v1",
      predicted_archetype: "Blind Copier" as const,
      archetype_probabilities: { "Blind Copier": 0.9 },
      confidence: 0.9
    }
    // heuristic_result not present (undefined)
  };
  assert.equal(scoringModesDisagree(scoring), false);
});

// ---------------------------------------------------------------------------
// Admin view-model: buildRecentSessionRows edge cases
// ---------------------------------------------------------------------------

test("buildRecentSessionRows returns empty array for empty session list", () => {
  const rows = buildRecentSessionRows([], "http://127.0.0.1:4173");
  assert.deepEqual(rows, []);
});

test("buildRecentSessionRows handles pending/unscored session with null scoring fields", () => {
  const pendingSession = makeSession({
    id: "session-pending",
    status: "created",
    has_scoring: false,
    integrity_verdict: null,
    haci_score: null,
    predicted_archetype: null,
    policy_recommendation: null,
    missing_streams: [],
    present_streams: [],
    event_counts_by_source: {}
  });

  const rows = buildRecentSessionRows([pendingSession], "http://127.0.0.1:4173");
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row.id, "session-pending");
  assert.equal(row.status, "created");
  assert.equal(row.hasScoring, "no");
  // integrity_verdict null → should not throw; should return a sensible default.
  assert.ok(typeof row.integrityVerdict === "string", "integrityVerdict must be a string even when null");
  // missingStreams should be "None" when missing_streams is empty.
  assert.equal(row.missingStreams, "None");
  // Reviewer URL must always be constructed.
  assert.equal(row.reviewerUrl, "http://127.0.0.1:4173?sessionId=session-pending");
});

test("buildRecentSessionRows handles session with multiple missing streams", () => {
  const session = makeSession({
    id: "session-missing",
    status: "invalid",
    integrity_verdict: "invalid",
    missing_streams: ["ide", "browser"],
    present_streams: ["desktop"]
  });

  const rows = buildRecentSessionRows([session], "http://127.0.0.1:4174");
  assert.equal(rows.length, 1);
  // Multiple missing streams must be joined.
  assert.ok(rows[0].missingStreams.includes("ide"), "ide must appear in missingStreams");
  assert.ok(rows[0].missingStreams.includes("browser"), "browser must appear in missingStreams");
});

test("buildRecentSessionRows constructs reviewer URL correctly for each session", () => {
  const sessions = [
    makeSession({ id: "s1" }),
    makeSession({ id: "s2" }),
    makeSession({ id: "s3" })
  ];

  const rows = buildRecentSessionRows(sessions, "http://example.com");
  assert.equal(rows.length, 3);
  assert.equal(rows[0].reviewerUrl, "http://example.com?sessionId=s1");
  assert.equal(rows[1].reviewerUrl, "http://example.com?sessionId=s2");
  assert.equal(rows[2].reviewerUrl, "http://example.com?sessionId=s3");
});
