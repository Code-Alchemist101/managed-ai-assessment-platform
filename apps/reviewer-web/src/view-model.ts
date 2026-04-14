import type { LocalRuntimeConfig, SessionDetail, SessionScoringPayload } from "@assessment-platform/contracts";
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

function humanizeEventType(eventType: string): string {
  return eventType
    .replace(/\./g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function buildTimelineEntries(eventsResponse: SessionEventsResponse | null): TimelineEntry[] {
  if (!eventsResponse) {
    return [];
  }
  return eventsResponse.events.slice(0, 10).map((event) => ({
    timestampLabel: new Date(event.timestamp_utc).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    label: humanizeEventType(event.event_type)
  }));
}

export function topFeatureLabels(scoring: SessionScoringPayload | null): string[] {
  return scoring?.top_features.map((feature) => `${feature.name} (${feature.contribution.toFixed(3)})`) ?? [];
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
