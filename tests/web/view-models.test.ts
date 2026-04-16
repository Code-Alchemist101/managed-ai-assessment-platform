import test from "node:test";
import assert from "node:assert/strict";
import {
  buildArchetypeProbabilityEntries,
  buildCompletenessSummary,
  buildSourceMix,
  buildTimelineEntries,
  eventCount,
  formatReviewerDecision,
  resolvePreferredSessionId,
  topFeatureLabels
} from "../../apps/reviewer-web/src/view-model";

test("reviewer view models map scoring and events into renderable content", () => {
  const timeline = buildTimelineEntries({
    session_id: "session-123",
    events: [
      {
        source: "desktop",
        event_type: "session.started",
        timestamp_utc: "2026-04-12T09:00:00Z",
        artifact_ref: "session",
        payload: {}
      },
      {
        source: "browser",
        event_type: "browser.ai.prompt",
        timestamp_utc: "2026-04-12T09:01:00Z",
        artifact_ref: "provider:openai",
        payload: {}
      }
    ]
  });

  assert.equal(timeline.length, 2);
  assert.match(timeline[0].label, /Session Started/);
  assert.equal(eventCount({
    session_id: "session-123",
    events: [
      {
        source: "desktop",
        event_type: "session.started",
        timestamp_utc: "2026-04-12T09:00:00Z",
        artifact_ref: "session",
        payload: {}
      },
      {
        source: "browser",
        event_type: "browser.ai.prompt",
        timestamp_utc: "2026-04-12T09:01:00Z",
        artifact_ref: "provider:openai",
        payload: {}
      }
    ]
  }), 2);
  assert.deepEqual(buildSourceMix({
    session_id: "session-123",
    events: [
      {
        source: "ide",
        event_type: "ide.document.changed",
        timestamp_utc: "2026-04-12T09:00:00Z",
        artifact_ref: "file:main.py",
        payload: {}
      },
      {
        source: "desktop",
        event_type: "session.started",
        timestamp_utc: "2026-04-12T09:00:01Z",
        artifact_ref: "session",
        payload: {}
      },
      {
        source: "ide",
        event_type: "ide.document.saved",
        timestamp_utc: "2026-04-12T09:00:02Z",
        artifact_ref: "file:main.py",
        payload: {}
      }
    ]
  }), [
    { source: "ide", count: 2 },
    { source: "desktop", count: 1 }
  ]);

  const features = topFeatureLabels({
    session_id: "session-123",
    model_version: "bootstrap-centroid-v1",
    scoring_mode: "heuristic",
    haci_score: 50,
    haci_band: "medium",
    predicted_archetype: "Structured Collaborator",
    archetype_probabilities: {
      "Independent Solver": 0.1,
      "Structured Collaborator": 0.2,
      "Prompt Engineer Solver": 0.1,
      "Iterative Debugger": 0.1,
      "AI-Dependent Constructor": 0.1,
      "Blind Copier": 0.1,
      "Exploratory Learner": 0.3
    },
    confidence: 0.3,
    top_features: [
      { name: "typing_vs_paste_ratio", contribution: 0.25 },
      { name: "max_paste_length", contribution: -0.1 }
    ],
    integrity: {
      verdict: "clean",
      flags: [],
      required_streams_present: ["desktop", "ide", "browser"],
      missing_streams: [],
      notes: []
    },
    policy_recommendation: "human-review",
    review_required: true,
    feature_vector: {
      session_id: "session-123",
      extraction_version: "0.1.0",
      generated_at: "2026-04-12T09:10:00Z",
      signal_values: {},
      signals: [],
      completeness: "complete",
      invalidation_reasons: []
    }
  });

  assert.deepEqual(features, ["typing_vs_paste_ratio (0.250)", "max_paste_length (-0.100)"]);
});

test("buildArchetypeProbabilityEntries returns ranked entries as percentages", () => {
  const entries = buildArchetypeProbabilityEntries({
    session_id: "session-123",
    model_version: "bootstrap-centroid-v1",
    scoring_mode: "heuristic",
    haci_score: 50,
    haci_band: "medium",
    predicted_archetype: "Exploratory Learner",
    archetype_probabilities: {
      "Independent Solver": 0.1,
      "Structured Collaborator": 0.2,
      "Exploratory Learner": 0.5,
      "Blind Copier": 0.05,
      "Iterative Debugger": 0.05,
      "AI-Dependent Constructor": 0.05,
      "Prompt Engineer Solver": 0.05
    },
    confidence: 0.5,
    top_features: [],
    integrity: {
      verdict: "clean",
      flags: [],
      required_streams_present: ["desktop", "ide"],
      missing_streams: [],
      notes: []
    },
    policy_recommendation: "auto-advance",
    review_required: false,
    feature_vector: {
      session_id: "session-123",
      extraction_version: "0.1.0",
      generated_at: "2026-04-12T09:10:00Z",
      signal_values: {},
      signals: [],
      completeness: "complete",
      invalidation_reasons: []
    }
  });

  assert.equal(entries.length, 7);
  assert.equal(entries[0].name, "Exploratory Learner");
  assert.equal(entries[0].probability, 0.5);
  assert.equal(entries[1].name, "Structured Collaborator");
  assert.equal(entries[1].probability, 0.2);
  assert.equal(entries[2].name, "Independent Solver");
  assert.equal(entries[2].probability, 0.1);

  assert.equal(buildArchetypeProbabilityEntries(null).length, 0);
});

test("formatReviewerDecision formats decision values for display", () => {
  assert.equal(formatReviewerDecision("approve"), "Approve");
  assert.equal(formatReviewerDecision("reject"), "Reject");
  assert.equal(formatReviewerDecision("needs_followup"), "Needs Follow-up");
});

test("reviewer completeness helpers support invalid sessions and direct session selection", () => {
  const sessions = [
    {
      id: "invalid-session",
      manifest_id: "manifest-python-cli-live-desktop-ide",
      manifest_name: "Desktop + IDE Live",
      candidate_id: "desktop-live",
      created_at: "2026-04-12T09:00:00Z",
      updated_at: "2026-04-12T09:01:00Z",
      status: "invalid" as const,
      has_scoring: true,
      required_streams: ["desktop", "ide"],
      present_streams: ["desktop"],
      event_counts_by_source: {
        desktop: 4
      },
      first_event_at: "2026-04-12T09:00:01Z",
      last_event_at: "2026-04-12T09:00:50Z",
      integrity_verdict: "invalid" as const,
      missing_streams: ["ide"],
      policy_recommendation: "invalid-session" as const,
      invalidation_reasons: ["missing_required_streams"],
      haci_score: 12,
      predicted_archetype: "Blind Copier" as const
    }
  ];

  const selectedSessionId = resolvePreferredSessionId(
    "invalid-session",
    {
      control_plane_url: "http://127.0.0.1:4010",
      ingestion_url: "http://127.0.0.1:4020/api/events",
      analytics_url: "http://127.0.0.1:4030",
      reviewer_url: "http://127.0.0.1:4173",
      admin_url: "http://127.0.0.1:4174",
      assessment_data_dir: "C:/tmp",
      latest_session_id: "invalid-session",
      latest_scored_session_id: null
    },
    sessions
  );

  assert.equal(selectedSessionId, "invalid-session");

  const completeness = buildCompletenessSummary(sessions[0]);
  assert.deepEqual(completeness.requiredStreams, ["desktop", "ide"]);
  assert.deepEqual(completeness.presentStreams, ["desktop"]);
  assert.deepEqual(completeness.missingStreams, ["ide"]);
  assert.deepEqual(completeness.invalidationReasons, ["missing_required_streams"]);
  assert.deepEqual(completeness.sourceCounts, [{ source: "desktop", count: 4 }]);
});
