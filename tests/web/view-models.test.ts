import test from "node:test";
import assert from "node:assert/strict";
import {
  buildArchetypeProbabilityEntries,
  buildArchetypeProbabilityEntriesFromMap,
  buildCompletenessSummary,
  buildIntegrityFlagLabels,
  buildSourceMix,
  buildTimelineEntries,
  confidenceLabel,
  eventCount,
  formatReviewerDecision,
  haciBandDescription,
  integrityVerdictDescription,
  resolvePreferredSessionId,
  scoringModeDescription,
  scoringModesDisagree,
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
  assert.match(timeline[1].label, /Browser Ai Prompt/);
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

test("buildArchetypeProbabilityEntriesFromMap ranks raw probability maps for dual-mode display", () => {
  const probabilities = {
    "Exploratory Learner": 0.45,
    "Structured Collaborator": 0.25,
    "Independent Solver": 0.15,
    "Blind Copier": 0.05,
    "Iterative Debugger": 0.04,
    "AI-Dependent Constructor": 0.04,
    "Prompt Engineer Solver": 0.02
  };

  const entries = buildArchetypeProbabilityEntriesFromMap(probabilities);

  assert.equal(entries.length, 7);
  assert.equal(entries[0].name, "Exploratory Learner");
  assert.equal(entries[0].probability, 0.45);
  assert.equal(entries[1].name, "Structured Collaborator");
  assert.equal(entries[1].probability, 0.25);
  assert.equal(entries[2].name, "Independent Solver");
  assert.equal(entries[2].probability, 0.15);

  assert.deepEqual(buildArchetypeProbabilityEntriesFromMap(undefined), []);
  assert.deepEqual(buildArchetypeProbabilityEntriesFromMap({}), []);
});

test("confidenceLabel returns mode-aware label distinguishing score strength from model confidence", () => {
  assert.equal(confidenceLabel("heuristic"), "Score Strength");
  assert.equal(confidenceLabel("trained_model"), "Model Confidence");
  // Any unrecognised mode falls back to the heuristic label (score strength)
  assert.equal(confidenceLabel("unknown"), "Score Strength");
});

test("buildTimelineEntries returns all events beyond the former 10-event cap", () => {
  // Build 15 events to verify no cap is applied
  const events = Array.from({ length: 15 }, (_, index) => ({
    source: "desktop" as const,
    event_type: `session.event_${index}`,
    timestamp_utc: `2026-04-12T09:${String(index).padStart(2, "0")}:00Z`,
    artifact_ref: "session",
    payload: {}
  }));

  const response = { session_id: "session-big", events };
  const timeline = buildTimelineEntries(response);

  assert.equal(timeline.length, 15, "all 15 events should be returned, not capped at 10");
  assert.match(timeline[0].label, /Session Event_0/);
  assert.match(timeline[14].label, /Session Event_14/);

  // eventCount still reflects the full set
  assert.equal(eventCount(response), 15);
});

test("scoringModesDisagree detects archetype disagreement between dual scoring modes", () => {
  const baseScoring = {
    session_id: "session-123",
    model_version: "bootstrap-centroid-v1",
    scoring_mode: "heuristic" as const,
    haci_score: 50,
    haci_band: "medium" as const,
    predicted_archetype: "Exploratory Learner" as const,
    archetype_probabilities: { "Exploratory Learner": 0.6, "Blind Copier": 0.4 },
    confidence: 0.6,
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
      session_id: "session-123",
      extraction_version: "0.1.0",
      generated_at: "2026-04-12T09:10:00Z",
      signal_values: {},
      signals: [],
      completeness: "complete" as const,
      invalidation_reasons: []
    }
  };

  const heuristicExploratory = {
    scoring_mode: "heuristic" as const,
    model_version: "bootstrap-centroid-v1",
    predicted_archetype: "Exploratory Learner" as const,
    archetype_probabilities: {},
    confidence: 0.6
  };
  const modelExploratory = {
    scoring_mode: "trained_model" as const,
    model_version: "xgboost-research-v1",
    predicted_archetype: "Exploratory Learner" as const,
    archetype_probabilities: {},
    confidence: 0.72
  };
  const modelBlindCopier = {
    scoring_mode: "trained_model" as const,
    model_version: "xgboost-research-v1",
    predicted_archetype: "Blind Copier" as const,
    archetype_probabilities: {},
    confidence: 0.55
  };

  // Returns false when scoring is null
  assert.equal(scoringModesDisagree(null), false);

  // Returns false when only heuristic_result is present (no trained_model_result)
  assert.equal(scoringModesDisagree({ ...baseScoring, heuristic_result: heuristicExploratory }), false);

  // Returns false when both modes agree on the same archetype
  assert.equal(scoringModesDisagree({
    ...baseScoring,
    heuristic_result: heuristicExploratory,
    trained_model_result: modelExploratory
  }), false);

  // Returns true when heuristic and trained-model predict different archetypes
  assert.equal(scoringModesDisagree({
    ...baseScoring,
    heuristic_result: heuristicExploratory,
    trained_model_result: modelBlindCopier
  }), true);
});

test("buildIntegrityFlagLabels renders low_information_session with reviewer-facing description", () => {
  const baseScoring = {
    session_id: "session-sparse",
    model_version: "bootstrap-centroid-v1",
    scoring_mode: "heuristic" as const,
    haci_score: 20,
    haci_band: "low" as const,
    predicted_archetype: "Independent Solver" as const,
    archetype_probabilities: { "Independent Solver": 0.71 },
    confidence: 0.71,
    top_features: [],
    integrity: {
      verdict: "review" as const,
      flags: ["low_information_session"],
      required_streams_present: ["desktop", "ide"],
      missing_streams: [],
      notes: ["Session has only 4 event(s); archetype scoring may be unreliable due to insufficient behavioral signal."]
    },
    policy_recommendation: "human-review" as const,
    review_required: true,
    feature_vector: {
      session_id: "session-sparse",
      extraction_version: "0.1.0",
      generated_at: "2026-04-12T09:10:00Z",
      signal_values: {},
      signals: [],
      completeness: "partial" as const,
      invalidation_reasons: []
    }
  };

  // null input returns empty array
  assert.deepEqual(buildIntegrityFlagLabels(null), []);

  const labels = buildIntegrityFlagLabels(baseScoring);
  assert.equal(labels.length, 1);
  // The label must contain the human-readable description and the flag name
  assert.match(labels[0], /Too few events for reliable scoring/);
  assert.match(labels[0], /low_information_session/);

  // Known flags with no descriptions fall back to humanized form
  const withUnknownFlag = {
    ...baseScoring,
    integrity: { ...baseScoring.integrity, flags: ["some_future_flag"] }
  };
  const unknownLabels = buildIntegrityFlagLabels(withUnknownFlag);
  assert.equal(unknownLabels.length, 1);
  assert.match(unknownLabels[0], /Some Future Flag/);
  assert.match(unknownLabels[0], /some_future_flag/);
});

test("haciBandDescription returns honest, threshold-grounded band descriptions", () => {
  // Each band returns a non-empty reviewer-facing string
  assert.match(haciBandDescription("high"), /strong independent-work signal/i);
  assert.match(haciBandDescription("high"), /≥ 70/);

  assert.match(haciBandDescription("medium"), /mixed or moderate/i);
  assert.match(haciBandDescription("medium"), /40.{1,3}69/);

  assert.match(haciBandDescription("low"), /limited independent-work signal/i);
  assert.match(haciBandDescription("low"), /< 40/);

  // Unknown or missing band returns empty string (no overclaiming)
  assert.equal(haciBandDescription(undefined), "");
  assert.equal(haciBandDescription(null), "");
  assert.equal(haciBandDescription("unknown"), "");
});

test("scoringModeDescription returns honest descriptions for each mode", () => {
  // Heuristic description notes it is always available and needs no artifacts
  assert.match(scoringModeDescription("heuristic"), /centroid/i);
  assert.match(scoringModeDescription("heuristic"), /always available/i);

  // Trained-model description notes probabilistic output and is not a guarantee
  assert.match(scoringModeDescription("trained_model"), /xgboost/i);
  assert.match(scoringModeDescription("trained_model"), /not a calibration guarantee/i);

  // Unknown mode returns empty string
  assert.equal(scoringModeDescription("unknown"), "");
});

test("integrityVerdictDescription returns brief reviewer-facing descriptions", () => {
  assert.match(integrityVerdictDescription("clean"), /all integrity checks passed/i);
  assert.match(integrityVerdictDescription("review"), /human review recommended/i);
  assert.match(integrityVerdictDescription("invalid"), /cannot be scored reliably/i);

  // Unknown verdict returns empty string
  assert.equal(integrityVerdictDescription("unknown"), "");
});

// ---------------------------------------------------------------------------
// Edge-case and partial-data hardening
// ---------------------------------------------------------------------------

test("buildTimelineEntries returns empty array for null events response", () => {
  assert.deepEqual(buildTimelineEntries(null), []);
});

test("buildTimelineEntries returns empty array for events response with empty events array", () => {
  assert.deepEqual(buildTimelineEntries({ session_id: "s", events: [] }), []);
});

test("eventCount returns 0 for null events response", () => {
  assert.equal(eventCount(null), 0);
});

test("buildSourceMix returns empty array for null events response", () => {
  assert.deepEqual(buildSourceMix(null), []);
});

test("buildSourceMix returns empty array for events response with no events", () => {
  assert.deepEqual(buildSourceMix({ session_id: "s", events: [] }), []);
});

test("buildCompletenessSummary returns all-empty struct for null session", () => {
  const result = buildCompletenessSummary(null);
  assert.deepEqual(result.requiredStreams, []);
  assert.deepEqual(result.presentStreams, []);
  assert.deepEqual(result.missingStreams, []);
  assert.deepEqual(result.invalidationReasons, []);
  assert.deepEqual(result.sourceCounts, []);
});

test("topFeatureLabels returns empty array for null scoring", () => {
  assert.deepEqual(topFeatureLabels(null), []);
});

test("resolvePreferredSessionId returns null when sessions list is empty", () => {
  const runtime = {
    control_plane_url: "http://127.0.0.1:4010",
    ingestion_url: "http://127.0.0.1:4020/api/events",
    analytics_url: "http://127.0.0.1:4030",
    reviewer_url: "http://127.0.0.1:4173",
    admin_url: "http://127.0.0.1:4174",
    assessment_data_dir: "C:/tmp",
    latest_session_id: null,
    latest_scored_session_id: null
  };
  assert.equal(resolvePreferredSessionId(null, runtime, []), null);
});

test("resolvePreferredSessionId falls back to latest_scored_session_id when query session not found", () => {
  const sessions = [
    {
      id: "session-a",
      manifest_id: "manifest-python-cli",
      manifest_name: "Python CLI Assessment",
      candidate_id: "cand-a",
      created_at: "2026-04-15T09:00:00Z",
      updated_at: "2026-04-15T09:01:00Z",
      status: "scored" as const,
      has_scoring: true,
      required_streams: ["desktop", "ide"],
      present_streams: ["desktop", "ide"],
      event_counts_by_source: { desktop: 3, ide: 2 },
      first_event_at: "2026-04-15T09:00:05Z",
      last_event_at: "2026-04-15T09:00:55Z",
      integrity_verdict: "clean" as const,
      missing_streams: [],
      policy_recommendation: "human-review" as const,
      invalidation_reasons: [],
      haci_score: 55,
      predicted_archetype: "Independent Solver" as const
    }
  ];

  const runtime = {
    control_plane_url: "http://127.0.0.1:4010",
    ingestion_url: "http://127.0.0.1:4020/api/events",
    analytics_url: "http://127.0.0.1:4030",
    reviewer_url: "http://127.0.0.1:4173",
    admin_url: "http://127.0.0.1:4174",
    assessment_data_dir: "C:/tmp",
    latest_session_id: "session-a",
    latest_scored_session_id: "session-a"
  };

  // Query session is not in the sessions list → should fall back to latest_scored_session_id.
  const resolved = resolvePreferredSessionId("does-not-exist", runtime, sessions);
  assert.equal(resolved, "session-a");
});

test("resolvePreferredSessionId falls back to first session when latest_scored_session_id is null", () => {
  const sessions = [
    {
      id: "session-b",
      manifest_id: "manifest-python-cli",
      manifest_name: "Python CLI Assessment",
      candidate_id: "cand-b",
      created_at: "2026-04-15T09:00:00Z",
      updated_at: "2026-04-15T09:01:00Z",
      status: "created" as const,
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
    }
  ];

  const runtime = {
    control_plane_url: "http://127.0.0.1:4010",
    ingestion_url: "http://127.0.0.1:4020/api/events",
    analytics_url: "http://127.0.0.1:4030",
    reviewer_url: "http://127.0.0.1:4173",
    admin_url: "http://127.0.0.1:4174",
    assessment_data_dir: "C:/tmp",
    latest_session_id: "session-b",
    latest_scored_session_id: null
  };

  // No query ID, no latest_scored_session_id → should return first session.
  const resolved = resolvePreferredSessionId(null, runtime, sessions);
  assert.equal(resolved, "session-b");
});

test("scoringModesDisagree returns false when trained_model_result is null", () => {
  const scoring = {
    session_id: "s",
    model_version: "bootstrap-centroid-v1",
    scoring_mode: "heuristic" as const,
    haci_score: 50,
    haci_band: "medium" as const,
    predicted_archetype: "Independent Solver" as const,
    archetype_probabilities: { "Independent Solver": 0.8 },
    confidence: 0.8,
    top_features: [],
    integrity: {
      verdict: "clean" as const,
      flags: [],
      required_streams_present: ["desktop"],
      missing_streams: [],
      notes: []
    },
    policy_recommendation: "human-review" as const,
    review_required: true,
    feature_vector: {
      session_id: "s",
      extraction_version: "0.1.0",
      generated_at: "2026-04-15T09:00:00Z",
      signal_values: {},
      signals: [],
      completeness: "complete" as const,
      invalidation_reasons: []
    },
    heuristic_result: {
      scoring_mode: "heuristic" as const,
      model_version: "bootstrap-centroid-v1",
      predicted_archetype: "Independent Solver" as const,
      archetype_probabilities: {},
      confidence: 0.8
    },
    trained_model_result: null
  };

  assert.equal(scoringModesDisagree(scoring), false);
});

test("buildIntegrityFlagLabels returns label for every known flag type", () => {
  const allFlagsScoring = {
    session_id: "s-all-flags",
    model_version: "bootstrap-centroid-v1",
    scoring_mode: "heuristic" as const,
    haci_score: 30,
    haci_band: "low" as const,
    predicted_archetype: "Blind Copier" as const,
    archetype_probabilities: { "Blind Copier": 0.9 },
    confidence: 0.9,
    top_features: [],
    integrity: {
      verdict: "review" as const,
      flags: [
        "unsupported_ai_provider",
        "unsupported_site_visited",
        "unmanaged_tool_detected",
        "sequence_gap_detected",
        "telemetry_heartbeat_missing",
        "suspicious_bulk_paste",
        "excessive_focus_switching",
        "excessive_idle_time"
      ],
      required_streams_present: ["desktop", "ide"],
      missing_streams: [],
      notes: []
    },
    policy_recommendation: "human-review" as const,
    review_required: true,
    feature_vector: {
      session_id: "s-all-flags",
      extraction_version: "0.1.0",
      generated_at: "2026-04-15T09:00:00Z",
      signal_values: {},
      signals: [],
      completeness: "partial" as const,
      invalidation_reasons: []
    }
  };

  const labels = buildIntegrityFlagLabels(allFlagsScoring);
  assert.equal(labels.length, 8);
  // Each label should contain the flag name in parentheses.
  for (const flag of allFlagsScoring.integrity.flags) {
    assert.ok(labels.some((l) => l.includes(`(${flag})`)), `Missing label for flag: ${flag}`);
  }
  // None of the known-flag labels should fall back to humanized form (they all have descriptions).
  for (const label of labels) {
    assert.ok(!label.startsWith("("), "Label should have a description before the flag name");
  }
});
