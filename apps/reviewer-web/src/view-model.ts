import type { LocalRuntimeConfig, ReviewerDecisionValue, SessionDetail, SessionScoringPayload } from "@assessment-platform/contracts";
import type { SessionEventsResponse } from "./api";

export type TimelineEntry = {
  timestampLabel: string;
  label: string;
};

export type SourceMixEntry = {
  source: string;
  count: number;
};

export type CompletenessSummary = {
  requiredStreams: string[];
  presentStreams: string[];
  missingStreams: string[];
  invalidationReasons: string[];
  sourceCounts: SourceMixEntry[];
};

export type ArchetypeProbabilityEntry = { name: string; probability: number };

export function formatReviewerDecision(decision: ReviewerDecisionValue): string {
  if (decision === "needs_followup") {
    return "Needs Follow-up";
  }
  return decision.charAt(0).toUpperCase() + decision.slice(1);
}

/**
 * Returns a reviewer-facing label for the confidence value that reflects how
 * it was produced.  Heuristic confidence is softmax-normalized score mass and
 * should NOT be presented as a calibrated probability.  Trained-model
 * confidence (predict_proba output) is probabilistic and can use the
 * conventional "Confidence" term.
 */
export function confidenceLabel(scoringMode: string): string {
  return scoringMode === "trained_model" ? "Model Confidence" : "Score Strength";
}

/**
 * Returns a brief reviewer-facing description of a HACI band.
 * Reflects the pipeline thresholds (high ≥ 70, medium ≥ 40, low < 40).
 * These are operational thresholds, not calibrated population benchmarks.
 */
export function haciBandDescription(band: string | null | undefined): string {
  switch (band) {
    case "high":
      return "Strong independent-work signal (score ≥ 70). Treat as one input among several.";
    case "medium":
      return "Mixed or moderate independent-work signal (score 40–69). Review supporting evidence.";
    case "low":
      return "Limited independent-work signal (score < 40). Additional context is especially important.";
    default:
      return "";
  }
}

/**
 * Returns a brief reviewer-facing description of a scoring mode.
 * Helps reviewers understand how the result was produced without overstating
 * scientific validity.
 */
export function scoringModeDescription(mode: string): string {
  switch (mode) {
    case "heuristic":
      return "Centroid-based heuristic scoring. Always available; no trained model artifacts required.";
    case "trained_model":
      return "XGBoost classifier scoring. Uses trained artifacts; output is probabilistic, not a calibration guarantee.";
    default:
      return "";
  }
}

/**
 * Returns a brief reviewer-facing description of an integrity verdict.
 */
export function integrityVerdictDescription(verdict: string): string {
  switch (verdict) {
    case "clean":
      return "All integrity checks passed. No flags raised.";
    case "review":
      return "One or more integrity flags raised. Human review recommended.";
    case "invalid":
      return "Session cannot be scored reliably. Integrity checks failed.";
    default:
      return "";
  }
}

/**
 * Returns true when both heuristic and trained-model results are present and
 * predict different archetypes.  Used to trigger a reviewer guidance banner.
 */
export function scoringModesDisagree(scoring: SessionScoringPayload | null): boolean {
  if (!scoring?.heuristic_result || !scoring?.trained_model_result) {
    return false;
  }
  return scoring.heuristic_result.predicted_archetype !== scoring.trained_model_result.predicted_archetype;
}

function humanizeEventType(eventType: string): string {
  return eventType
    .replace(/\./g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function buildTimelineEntries(eventsResponse: SessionEventsResponse | null): TimelineEntry[] {
  if (!eventsResponse) {
    return [];
  }
  return eventsResponse.events.map((event) => ({
    timestampLabel: new Date(event.timestamp_utc).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    label: humanizeEventType(event.event_type)
  }));
}

export function topFeatureLabels(scoring: SessionScoringPayload | null): string[] {
  return scoring?.top_features.map((feature) => `${feature.name} (${feature.contribution.toFixed(3)})`) ?? [];
}

export function buildArchetypeProbabilityEntries(scoring: SessionScoringPayload | null): ArchetypeProbabilityEntry[] {
  if (!scoring) {
    return [];
  }
  return buildArchetypeProbabilityEntriesFromMap(scoring.archetype_probabilities);
}

export function buildArchetypeProbabilityEntriesFromMap(
  probabilities: Record<string, number> | undefined
): ArchetypeProbabilityEntry[] {
  if (!probabilities) {
    return [];
  }
  return Object.entries(probabilities)
    .map(([name, probability]) => ({ name, probability }))
    .sort((left, right) => right.probability - left.probability || left.name.localeCompare(right.name));
}

const integrityFlagDescriptions: Record<string, string> = {
  missing_required_streams: "Missing required telemetry streams.",
  unsupported_ai_provider: "Used an AI provider outside the allowed list.",
  unsupported_site_visited: "Visited a site outside the allowed list.",
  unmanaged_tool_detected: "Detected unmanaged tool usage.",
  tamper_signal_detected: "Detected potential tamper signals.",
  sequence_gap_detected: "Detected event sequence gaps in one or more streams.",
  telemetry_heartbeat_missing: "Desktop telemetry heartbeat is missing.",
  suspicious_bulk_paste: "Detected unusually large pasted content.",
  excessive_focus_switching: "Detected excessive app focus switching.",
  excessive_idle_time: "Detected excessive idle time during session.",
  unmanaged_browser_detected: "Detected unmanaged browser usage.",
  low_information_session: "Too few events for reliable scoring; archetype label should be treated as indicative only."
};

function humanizeFlag(flag: string): string {
  return flag
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function buildIntegrityFlagLabels(scoring: SessionScoringPayload | null): string[] {
  if (!scoring) {
    return [];
  }

  return scoring.integrity.flags.map((flag) => `${integrityFlagDescriptions[flag] ?? humanizeFlag(flag)} (${flag})`);
}

export function eventCount(eventsResponse: SessionEventsResponse | null): number {
  return eventsResponse?.events.length ?? 0;
}

export function buildSourceMix(eventsResponse: SessionEventsResponse | null): SourceMixEntry[] {
  if (!eventsResponse) {
    return [];
  }

  const counts = new Map<string, number>();
  for (const event of eventsResponse.events) {
    counts.set(event.source, (counts.get(event.source) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([source, count]) => ({ source, count }))
    .sort((left, right) => right.count - left.count || left.source.localeCompare(right.source));
}

export function buildCompletenessSummary(session: SessionDetail | null): CompletenessSummary {
  const sourceCounts = Object.entries(session?.event_counts_by_source ?? {})
    .map(([source, count]) => ({ source, count }))
    .sort((left, right) => right.count - left.count || left.source.localeCompare(right.source));

  return {
    requiredStreams: session?.required_streams ?? [],
    presentStreams: session?.present_streams ?? [],
    missingStreams: session?.missing_streams ?? [],
    invalidationReasons: session?.invalidation_reasons ?? [],
    sourceCounts
  };
}

export function resolvePreferredSessionId(
  querySessionId: string | null,
  runtime: LocalRuntimeConfig,
  sessions: SessionDetail[]
): string | null {
  if (querySessionId && sessions.some((session) => session.id === querySessionId)) {
    return querySessionId;
  }

  if (runtime.latest_scored_session_id && sessions.some((session) => session.id === runtime.latest_scored_session_id)) {
    return runtime.latest_scored_session_id;
  }

  return sessions[0]?.id ?? null;
}
