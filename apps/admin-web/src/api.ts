import type { LocalRuntimeConfig, SessionDetail } from "@assessment-platform/contracts";

const controlPlaneUrl = import.meta.env.VITE_CONTROL_PLANE_URL ?? "http://127.0.0.1:4010";

export type AdminManifest = {
  id: string;
  name: string;
  task_prompt: string;
  language: string;
  allowed_ai_providers: string[];
  allowed_sites: string[];
  required_streams: string[];
  evidence_settings: {
    screenshots_enabled: boolean;
    screen_recording_metadata_only: boolean;
  };
  decision_policy: {
    auto_advance_min_confidence: number;
    auto_reject_enabled: boolean;
    require_full_completeness: boolean;
  };
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

export async function loadManifests(): Promise<AdminManifest[]> {
  return fetchJson<AdminManifest[]>(`${controlPlaneUrl}/api/manifests`);
}

export async function loadSessions(): Promise<SessionDetail[]> {
  return fetchJson<SessionDetail[]>(`${controlPlaneUrl}/api/sessions`);
}
