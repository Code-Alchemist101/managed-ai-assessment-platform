import path from "node:path";
import type { SessionDetail, SessionManifest } from "@assessment-platform/contracts";

export const defaultDesktopManifestId = "manifest-python-cli-live-desktop-ide";

export type DesktopReadinessState =
  | "launching"
  | "awaiting_ide_stream"
  | "awaiting_browser_stream"
  | "awaiting_live_streams"
  | "ready_to_score"
  | "submitted"
  | "scored"
  | "invalid";

export type BrowserCaptureState =
  | "not_required"
  | "idle"
  | "launch_requested"
  | "awaiting_browser_stream"
  | "telemetry_live";

type SessionDetailLike = Pick<
  SessionDetail,
  "status" | "required_streams" | "event_counts_by_source" | "missing_streams" | "integrity_verdict"
>;

type ManifestLike = Pick<SessionManifest, "id" | "name" | "required_streams">;

export function normalizeIngestionEventEndpoint(url: string): string {
  const trimmedUrl = url.trim().replace(/\/+$/, "");
  return trimmedUrl.endsWith("/api/events") ? trimmedUrl : `${trimmedUrl}/api/events`;
}

export function guardStartManagedSession(activeSession: boolean): string | null {
  return activeSession ? "A managed session is already active. End the current session before starting another." : null;
}

export function deriveWindowsNativeVsCodeExecutablePath(executablePath: string): string | null {
  const executableName = path.win32.basename(executablePath).toLowerCase();
  const nativeExecutableName =
    executableName === "code.cmd"
      ? "Code.exe"
      : executableName === "code-insiders.cmd"
        ? "Code - Insiders.exe"
        : null;

  if (!nativeExecutableName) {
    return null;
  }

  return path.win32.join(path.win32.dirname(path.win32.dirname(executablePath)), nativeExecutableName);
}

export function buildManagedBrowserLaunchArgs(profilePath: string, extensionPath: string, bootstrapUrl: string): string[] {
  return [
    "--new-window",
    "--no-first-run",
    "--no-default-browser-check",
    `--user-data-dir=${profilePath}`,
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
    bootstrapUrl
  ];
}

export function selectPreferredManifest<T extends ManifestLike>(
  manifests: T[],
  preferredManifestId: string | null | undefined,
  fallbackManifestId = defaultDesktopManifestId
): T | null {
  const preferredIds = [preferredManifestId, fallbackManifestId].filter((value): value is string => Boolean(value));
  for (const manifestId of preferredIds) {
    const manifest = manifests.find((item) => item.id === manifestId);
    if (manifest) {
      return manifest;
    }
  }
  return manifests[0] ?? null;
}

export function resolveAutoStartWorkspacePath(workspacePath: string | null | undefined): string | null {
  const trimmedWorkspacePath = workspacePath?.trim();
  return trimmedWorkspacePath ? path.win32.resolve(trimmedWorkspacePath) : null;
}

export function shouldAutoStartManagedSession(options: {
  autoStartWorkspacePath: string | null;
  autoStartTriggered: boolean;
  activeSession: boolean;
  launchInProgress: boolean;
}): boolean {
  return Boolean(options.autoStartWorkspacePath)
    && !options.autoStartTriggered
    && !options.activeSession
    && !options.launchInProgress;
}

export function deriveManifestPickerDisabled(activeSession: boolean, launchInProgress = false): boolean {
  return activeSession || launchInProgress;
}

export function deriveCanAbandonSession(activeSession: boolean): boolean {
  return activeSession;
}

export function getMissingRequiredNonDesktopStreams(sessionDetail: SessionDetailLike | null): string[] {
  if (!sessionDetail) {
    return [];
  }

  const requiredNonDesktop = sessionDetail.required_streams.filter((stream) => stream !== "desktop");
  return requiredNonDesktop.filter((stream) => (sessionDetail.event_counts_by_source[stream] ?? 0) === 0);
}

export function deriveBrowserCaptureStatus(
  manifest: ManifestLike | null,
  sessionDetail: SessionDetailLike | null,
  sessionInProgress = false,
  browserLaunchRequested = false,
  browserLaunched = false
): {
  state: BrowserCaptureState;
  reason: string;
} {
  const browserRequired = manifest?.required_streams.includes("browser") ?? false;
  if (!browserRequired) {
    return {
      state: "not_required",
      reason: "The selected manifest does not require managed browser telemetry."
    };
  }

  const browserEventCount = sessionDetail?.event_counts_by_source.browser ?? 0;
  if (sessionInProgress && browserEventCount > 0) {
    return {
      state: "telemetry_live",
      reason: "Managed Edge bootstrap completed and browser telemetry is arriving for this session."
    };
  }

  if (sessionInProgress && browserLaunched) {
    return {
      state: "awaiting_browser_stream",
      reason: "Managed Edge launched. Waiting for the session-scoped bootstrap page to emit the first browser event."
    };
  }

  if (sessionInProgress && browserLaunchRequested) {
    return {
      state: "launch_requested",
      reason: "Managed Edge launch requested. Waiting for the managed browser window to open."
    };
  }

  if (sessionInProgress && (sessionDetail?.status === "active" || sessionDetail?.status === "submitted")) {
    return {
      state: "awaiting_browser_stream",
      reason: "Waiting for the first browser telemetry event before the full live session can be scored."
    };
  }

  return {
    state: "idle",
    reason: "This manifest requires managed browser capture. Edge will launch in a session-scoped profile when the next session starts."
  };
}

export function deriveDesktopReadiness(
  sessionDetail: SessionDetailLike | null,
  launchInProgress = false
): {
  state: DesktopReadinessState;
  reason: string;
  canScore: boolean;
} {
  if (sessionDetail?.status === "submitted") {
    return {
      state: "submitted",
      reason: "The session has been submitted for scoring.",
      canScore: false
    };
  }

  if (sessionDetail?.status === "scored") {
    return {
      state: "scored",
      reason: "Scoring completed successfully for this session.",
      canScore: false
    };
  }

  if (sessionDetail?.status === "invalid") {
    const invalidReason = sessionDetail.missing_streams.length
      ? `Session invalid. Missing required streams: ${sessionDetail.missing_streams.join(", ")}.`
      : sessionDetail.integrity_verdict === "invalid"
        ? "Session invalidated by integrity policy."
        : "Session is marked invalid.";
    return {
      state: "invalid",
      reason: invalidReason,
      canScore: false
    };
  }

  const missingRequiredNonDesktopStreams = getMissingRequiredNonDesktopStreams(sessionDetail);

  if (launchInProgress || !sessionDetail || sessionDetail.status === "created") {
    return {
      state: "launching",
      reason: "Starting the managed session and waiting for live telemetry to arrive.",
      canScore: false
    };
  }

  if (missingRequiredNonDesktopStreams.length > 1) {
    return {
      state: "awaiting_live_streams",
      reason: `Waiting for required live telemetry before scoring can be enabled: ${missingRequiredNonDesktopStreams.join(", ")}.`,
      canScore: false
    };
  }

  if (missingRequiredNonDesktopStreams.includes("ide")) {
    return {
      state: "awaiting_ide_stream",
      reason: "Waiting for the first IDE telemetry event before scoring can be enabled.",
      canScore: false
    };
  }

  if (missingRequiredNonDesktopStreams.includes("browser")) {
    return {
      state: "awaiting_browser_stream",
      reason: "Waiting for the first browser telemetry event before scoring can be enabled.",
      canScore: false
    };
  }

  if (missingRequiredNonDesktopStreams.length > 0) {
    return {
      state: "awaiting_live_streams",
      reason: `Waiting for required non-desktop telemetry: ${missingRequiredNonDesktopStreams.join(", ")}.`,
      canScore: false
    };
  }

  return {
    state: "ready_to_score",
    reason: "All required non-desktop telemetry streams are present. You can end and score the session.",
    canScore: true
  };
}
