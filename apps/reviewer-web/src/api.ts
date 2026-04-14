import type { LocalRuntimeConfig, SessionDetail, SessionScoringPayload } from "@assessment-platform/contracts";

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
    throw new Error(`Request failed: ${response.status} ${response.statusText}`);
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

export async function loadScoringIfPresent(sessionId: string): Promise<SessionScoringPayload | null> {
  try {
    return await loadScoring(sessionId);
  } catch (error) {
    if (error instanceof Error && error.message.includes("404")) {
      return null;
    }
    throw error;
  }
}

export async function loadSessionEvents(sessionId: string): Promise<SessionEventsResponse> {
  return fetchJson<SessionEventsResponse>(`${controlPlaneUrl}/api/sessions/${sessionId}/events`);
}
