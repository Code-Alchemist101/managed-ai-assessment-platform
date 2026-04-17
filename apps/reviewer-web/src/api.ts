import type { LocalRuntimeConfig, SessionDetail, SessionScoringPayload, ReviewerDecision, ReviewerDecisionValue } from "@assessment-platform/contracts";

const controlPlaneUrl = import.meta.env.VITE_CONTROL_PLANE_URL ?? "http://127.0.0.1:4010";

export type SessionEventsResponse = {
  session_id: string;
  events: Array<{
    source: string;
    event_type: string;
    timestamp_utc: string;
    artifact_ref: string;
    payload: Record<string, unknown>;
  }>;
};

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw Object.assign(new Error(`Request failed: ${response.status} ${response.statusText}`), { status: response.status });
  }
  return response.json() as Promise<T>;
}

export async function loadRuntimeConfig(): Promise<LocalRuntimeConfig> {
  return fetchJson<LocalRuntimeConfig>(`${controlPlaneUrl}/api/runtime`);
}

export async function loadSessions(): Promise<SessionDetail[]> {
  return fetchJson<SessionDetail[]>(`${controlPlaneUrl}/api/sessions`);
}

export async function loadSessionDetail(sessionId: string): Promise<SessionDetail> {
  return fetchJson<SessionDetail>(`${controlPlaneUrl}/api/sessions/${sessionId}`);
}

export async function loadScoring(sessionId: string): Promise<SessionScoringPayload> {
  return fetchJson<SessionScoringPayload>(`${controlPlaneUrl}/api/sessions/${sessionId}/scoring`);
}

function isNotFoundError(error: unknown): boolean {
  return error !== null && typeof error === "object" && "status" in error && (error as { status: number }).status === 404;
}

export async function loadScoringIfPresent(sessionId: string): Promise<SessionScoringPayload | null> {
  try {
    return await loadScoring(sessionId);
  } catch (error) {
    if (isNotFoundError(error)) {
      return null;
    }
    throw error;
  }
}

export async function loadSessionEvents(sessionId: string): Promise<SessionEventsResponse> {
  return fetchJson<SessionEventsResponse>(`${controlPlaneUrl}/api/sessions/${sessionId}/events`);
}

export async function loadDecision(sessionId: string): Promise<ReviewerDecision | null> {
  const raw = await fetchJson<ReviewerDecision | { decision: null; exists: true }>(
    `${controlPlaneUrl}/api/sessions/${sessionId}/decision`
  );
  if ("exists" in raw) {
    return null;
  }
  return raw;
}

export async function saveDecision(sessionId: string, decision: ReviewerDecisionValue, note?: string): Promise<ReviewerDecision> {
  const response = await fetch(`${controlPlaneUrl}/api/sessions/${sessionId}/decision`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ decision, note })
  });
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<ReviewerDecision>;
}
