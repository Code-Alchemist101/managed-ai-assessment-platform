import { app, BrowserWindow, dialog, shell } from "electron";
import { spawn, execFile } from "node:child_process";
import { mkdir, appendFile, access, constants as fsConstants } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";
import crypto from "node:crypto";
import type { SessionDetail, SessionManifest, SessionSummary } from "@assessment-platform/contracts";
import {
  buildManagedBrowserLaunchArgs,
  defaultDesktopManifestId,
  deriveBrowserCaptureStatus,
  deriveCanAbandonSession,
  deriveDesktopReadiness,
  deriveManifestPickerDisabled,
  resolveAutoStartWorkspacePath,
  shouldAutoStartManagedSession,
  deriveWindowsNativeVsCodeExecutablePath,
  guardStartManagedSession,
  normalizeIngestionEventEndpoint,
  selectPreferredManifest,
  type DesktopReadinessState
} from "./session-helpers";

const execFileAsync = promisify(execFile);

const controlPlaneUrl = process.env.CONTROL_PLANE_URL ?? "http://127.0.0.1:4010";
const ingestionBaseUrl = process.env.INGESTION_URL ?? "http://127.0.0.1:4020";
const reviewerUrl = process.env.REVIEWER_URL ?? "http://127.0.0.1:4173";
const preferredManifestId = process.env.ASSESSMENT_MANIFEST_ID ?? defaultDesktopManifestId;
const defaultVsCodeExecutable = process.env.VSCODE_EXECUTABLE ?? "code.cmd";
const defaultEdgeExecutable = process.env.EDGE_EXECUTABLE ?? "msedge.exe";
const repoRoot = path.resolve(process.env.ASSESSMENT_PLATFORM_ROOT ?? process.cwd());
const defaultVsCodeExtensionDevelopmentPath = process.env.VSCODE_EXTENSION_DEVELOPMENT_PATH
  ?? path.join(repoRoot, "extensions", "vscode-assessment");
const defaultEdgeExtensionPath = process.env.EDGE_EXTENSION_PATH
  ?? path.join(repoRoot, "extensions", "edge-managed");
const spoolDir = path.resolve(process.cwd(), process.env.ASSESSMENT_DATA_DIR ?? ".runtime-data", "desktop-spool");
const browserProfilesDir = path.resolve(process.cwd(), process.env.ASSESSMENT_DATA_DIR ?? ".runtime-data", "browser-profiles");
const autoStartWorkspacePath = resolveAutoStartWorkspacePath(process.env.ASSESSMENT_AUTO_START_WORKSPACE);
const configuredAutoStartDelayMs = Number.parseInt(process.env.ASSESSMENT_AUTO_START_DELAY_MS ?? "1000", 10);
const autoStartDelayMs = Number.isFinite(configuredAutoStartDelayMs) && configuredAutoStartDelayMs >= 0
  ? configuredAutoStartDelayMs
  : 1000;
const autoEndWhenReady = /^(1|true|yes)$/i.test(process.env.ASSESSMENT_AUTO_END_WHEN_READY ?? "");
const configuredAutoEndDelayMs = Number.parseInt(process.env.ASSESSMENT_AUTO_END_DELAY_MS ?? "1500", 10);
const autoEndDelayMs = Number.isFinite(configuredAutoEndDelayMs) && configuredAutoEndDelayMs >= 0
  ? configuredAutoEndDelayMs
  : 1500;

function isAbortedWindowLoad(error: unknown): boolean {
  return error instanceof Error && error.message.includes("ERR_ABORTED");
}

const ingestionEventEndpoint = normalizeIngestionEventEndpoint(ingestionBaseUrl);

type ManifestSummary = {
  id: string;
  name: string;
  required_streams: string[];
};

type ScoreSessionResponse = {
  session: SessionSummary;
  scoring: {
    haci_score: number;
    predicted_archetype: string;
  };
};

type DesktopViewModel = {
  manifestName: string | null;
  selectedManifestId: string | null;
  selectedManifestName: string | null;
  selectedManifestRequiredStreams: string[];
  availableManifests: ManifestSummary[];
  manifestPickerDisabled: boolean;
  sessionId: string | null;
  sessionStatus: string;
  readinessState: DesktopReadinessState;
  readinessReason: string;
  browserStatusState: string;
  browserStatusReason: string;
  workspacePath: string | null;
  latestMessage: string | null;
  latestError: string | null;
  reviewerSessionUrl: string | null;
  hasPendingSpool: boolean;
  scoringSummary: {
    haciScore: number;
    predictedArchetype: string;
  } | null;
  usingVsCodeExecutable: string;
  usingEdgeExecutable: string;
  heartbeatActive: boolean;
  activeSession: boolean;
  canScoreSession: boolean;
  canAbandonSession: boolean;
  requiredStreams: string[];
  presentStreams: string[];
  missingStreams: string[];
};

type SessionEventDelivery = "sent" | "spooled";

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function quoteForCmd(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function isWindowsBatchScript(executablePath: string): boolean {
  return /\.(cmd|bat)$/i.test(executablePath);
}

async function resolveExecutableOnPath(command: string): Promise<string | null> {
  try {
    if (process.platform === "win32") {
      const { stdout } = await execFileAsync("where", [command]);
      return stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean) ?? null;
    }
    const { stdout } = await execFileAsync("which", [command]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

class DesktopSessionRuntime {
  private sessionId: string | null = null;
  private sessionStatus = "idle";
  private sessionDetail: SessionDetail | null = null;
  private activeManifest: SessionManifest | null = null;
  private manifestInventory: SessionManifest[] = [];
  private selectedManifestId: string | null = preferredManifestId;
  private workspacePath: string | null = null;
  private manifestName: string | null = null;
  private sequenceNo = 0;
  private latestMessage: string | null = "Choose a workspace to start a real managed desktop + VS Code session.";
  private latestError: string | null = null;
  private reviewerSessionUrl: string | null = null;
  private hasPendingSpool = false;
  private scoringSummary: DesktopViewModel["scoringSummary"] = null;
  private resolvedVsCodeExecutable = defaultVsCodeExecutable;
  private resolvedVsCodeExtensionDevelopmentPath: string | null = null;
  private resolvedEdgeExecutable = defaultEdgeExecutable;
  private resolvedEdgeExtensionPath: string | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private sessionPollTimer: NodeJS.Timeout | null = null;
  private activeSession = false;
  private launchInProgress = false;
  private browserLaunchRequested = false;
  private browserLaunched = false;
  private autoStartTriggered = false;
  private autoEndTriggered = false;

  constructor(private readonly onChange: () => void) {}

  async initialize(window?: BrowserWindow): Promise<void> {
    try {
      await this.refreshManifestInventory();
      if (window) {
        await this.maybeAutoStartManagedSession(window);
      }
    } catch (error) {
      console.error("Failed to load manifest inventory", error);
    }
  }

  getViewModel(): DesktopViewModel {
    const readiness = deriveDesktopReadiness(this.sessionDetail, this.launchInProgress);
    const selectedManifest = this.getSelectedManifest();
    const browserStatus = deriveBrowserCaptureStatus(
      this.activeSession ? this.activeManifest : selectedManifest,
      this.sessionDetail,
      this.activeSession,
      this.browserLaunchRequested,
      this.browserLaunched
    );
    return {
      manifestName: this.manifestName,
      selectedManifestId: selectedManifest?.id ?? this.selectedManifestId,
      selectedManifestName: selectedManifest?.name ?? null,
      selectedManifestRequiredStreams: selectedManifest?.required_streams ?? [],
      availableManifests: this.manifestInventory.map((manifest) => ({
        id: manifest.id,
        name: manifest.name,
        required_streams: manifest.required_streams
      })),
      manifestPickerDisabled: deriveManifestPickerDisabled(this.activeSession, this.launchInProgress),
      sessionId: this.sessionId,
      sessionStatus: this.sessionStatus,
      readinessState: readiness.state,
      readinessReason: readiness.reason,
      browserStatusState: browserStatus.state,
      browserStatusReason: browserStatus.reason,
      workspacePath: this.workspacePath,
      latestMessage: this.latestMessage,
      latestError: this.latestError,
      reviewerSessionUrl: this.reviewerSessionUrl,
      hasPendingSpool: this.hasPendingSpool,
      scoringSummary: this.scoringSummary,
      usingVsCodeExecutable: this.resolvedVsCodeExecutable,
      usingEdgeExecutable: this.resolvedEdgeExecutable,
      heartbeatActive: this.heartbeatTimer !== null,
      activeSession: this.activeSession,
      canScoreSession: readiness.canScore,
      canAbandonSession: deriveCanAbandonSession(this.activeSession),
      requiredStreams: this.sessionDetail?.required_streams ?? this.activeManifest?.required_streams ?? selectedManifest?.required_streams ?? [],
      presentStreams: this.sessionDetail?.present_streams ?? [],
      missingStreams: this.sessionDetail?.missing_streams
        ?? (this.activeManifest?.required_streams.filter((stream) => stream !== "desktop")
          ?? selectedManifest?.required_streams.filter((stream) => stream !== "desktop")
          ?? [])
    };
  }

  async selectManifest(manifestId: string): Promise<void> {
    if (deriveManifestPickerDisabled(this.activeSession, this.launchInProgress)) {
      this.setError("Manifest selection is locked while a managed session is active.");
      return;
    }

    if (this.manifestInventory.length === 0) {
      try {
        await this.refreshManifestInventory();
      } catch (error) {
        this.setError(this.formatError("Failed to refresh the manifest inventory", error));
        return;
      }
    }

    const manifest = this.manifestInventory.find((item) => item.id === manifestId);
    if (!manifest) {
      this.setError(`The selected manifest "${manifestId}" is not available from the control plane inventory.`);
      return;
    }

    this.selectedManifestId = manifest.id;
    if (!this.sessionId) {
      this.manifestName = manifest.name;
    }
    this.setMessage(
      `Selected ${manifest.name}. Required streams: ${manifest.required_streams.join(", ")}.`
    );
  }

  async startManagedSession(window: BrowserWindow, workspacePathOverride?: string): Promise<void> {
    const startGuardError = guardStartManagedSession(this.activeSession);
    if (startGuardError) {
      this.setError(startGuardError);
      return;
    }

    const workspacePath = workspacePathOverride
      ? path.resolve(workspacePathOverride)
      : await this.promptForWorkspacePath(window);
    if (!workspacePath) {
      return;
    }
    this.workspacePath = workspacePath;
    this.latestError = null;
    this.scoringSummary = null;
    this.reviewerSessionUrl = null;
    this.sessionDetail = null;
    this.activeManifest = null;
    this.browserLaunchRequested = false;
    this.browserLaunched = false;
    this.autoEndTriggered = false;
    this.launchInProgress = true;
    this.sessionStatus = "launching";
    this.onChange();

    try {
      await this.refreshManifestInventory();
      const manifest = this.getSelectedManifest();
      if (!manifest) {
        throw new Error("No assessment manifest is available.");
      }
      this.activeManifest = manifest;

      const createdSession = await this.fetchJson<SessionSummary>(`${controlPlaneUrl}/api/sessions`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          manifest_id: manifest.id,
          candidate_id: "desktop-live"
        })
      });

      this.sessionId = createdSession.id;
      this.sequenceNo = 0;
      this.hasPendingSpool = false;
      this.activeSession = true;
      this.sessionStatus = "created";
      this.manifestName = manifest.name;
      this.reviewerSessionUrl = `${reviewerUrl}?sessionId=${createdSession.id}`;

      await this.fetchJson<SessionSummary>(`${controlPlaneUrl}/api/sessions/${createdSession.id}/status`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({ status: "active" })
      });

      this.sessionStatus = "active";
      await this.syncSessionDetail();
      await this.sendEvent("session.started", "session", {
        status: "active",
        managed_session: true,
        workspace_path: workspacePath,
        manifest_id: manifest.id,
        candidate_id: createdSession.candidate_id
      });
      await this.sendEvent("desktop.workspace.selected", `workspace:${workspacePath}`, {
        workspace_path: workspacePath
      });
      await this.sendEvent("desktop.vscode.launch.requested", `workspace:${workspacePath}`, {
        requested_executable: this.resolvedVsCodeExecutable,
        extension_development_path: defaultVsCodeExtensionDevelopmentPath,
        workspace_path: workspacePath
      });

      this.resolvedVsCodeExecutable = await this.resolveVsCodeExecutable();
      this.resolvedVsCodeExtensionDevelopmentPath = await this.resolveVsCodeExtensionDevelopmentPath();
      await this.launchVsCode(workspacePath);
      await this.sendEvent("desktop.vscode.launched", `workspace:${workspacePath}`, {
        executable: this.resolvedVsCodeExecutable,
        extension_development_path: this.resolvedVsCodeExtensionDevelopmentPath,
        workspace_path: workspacePath
      });

      if (manifest.required_streams.includes("browser")) {
        this.browserLaunchRequested = true;
        this.onChange();
        await this.sendEvent("desktop.browser.launch.requested", `workspace:${workspacePath}`, {
          requested_executable: defaultEdgeExecutable,
          extension_path: defaultEdgeExtensionPath,
          workspace_path: workspacePath
        });
        this.resolvedEdgeExecutable = await this.resolveEdgeExecutable();
        this.resolvedEdgeExtensionPath = await this.resolveEdgeExtensionPath();
        await this.launchManagedBrowser(createdSession.id);
        this.browserLaunched = true;
        this.onChange();
        await this.sendEvent("desktop.browser.launched", `workspace:${workspacePath}`, {
          executable: this.resolvedEdgeExecutable,
          extension_path: this.resolvedEdgeExtensionPath,
          workspace_path: workspacePath
        });
      }

      this.startHeartbeatLoop();
      this.startSessionPollLoop();
      await this.sendHeartbeat({ silent: true });
      await this.syncSessionDetail();
      this.launchInProgress = false;
      this.onChange();
      if (this.hasPendingSpool) {
        this.setMessage(
          `Session ${createdSession.id} is active, but at least one desktop event was queued locally because ingestion was unavailable.`
        );
      } else {
        this.setMessage(`Session ${createdSession.id} is active. VS Code launched for ${workspacePath}.`);
      }
    } catch (error) {
      if (this.sessionId) {
        await this.safeInvalidateSession(this.sessionId);
      }
      this.stopHeartbeatLoop();
      this.stopSessionPollLoop();
      this.activeSession = false;
      this.launchInProgress = false;
      this.browserLaunchRequested = false;
      this.browserLaunched = false;
      this.sessionStatus = "invalid";
      this.setError(this.formatError("Failed to start the managed session", error));
    }
  }

  async sendHeartbeat(options?: { silent?: boolean }): Promise<void> {
    if (!this.sessionId || !this.activeSession) {
      if (!options?.silent) {
        this.setMessage("There is no active managed session to heartbeat.");
      }
      return;
    }
    try {
      await this.sendEvent("session.heartbeat", "session", {
        status: "active"
      });
      if (options?.silent) {
        return;
      }
      if (this.hasPendingSpool) {
        this.setMessage("Heartbeat queued locally because ingestion is unavailable.");
      } else {
        this.setMessage(`Heartbeat sent for session ${this.sessionId}.`);
      }
    } catch (error) {
      this.setError(this.formatError("Failed to send heartbeat", error));
    }
  }

  async abandonManagedSession(): Promise<void> {
    if (!this.sessionId || !this.activeSession) {
      this.setMessage("There is no active managed session to abandon.");
      return;
    }

    const activeSessionId = this.sessionId;

    try {
      const delivery = await this.sendEvent("session.abandoned", "session", {
        status: "invalid",
        reason: "operator_reset"
      });

      await this.fetchJson<SessionSummary>(`${controlPlaneUrl}/api/sessions/${activeSessionId}/status`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({ status: "invalid" })
      });

      this.stopHeartbeatLoop();
      this.stopSessionPollLoop();
      this.activeSession = false;
      this.launchInProgress = false;
      this.browserLaunchRequested = false;
      this.browserLaunched = false;
      this.sessionStatus = "invalid";
      await this.syncSessionDetail();

      if (delivery === "spooled" || this.hasPendingSpool) {
        this.setMessage(
          `Session ${activeSessionId} was marked invalid. One or more desktop reset events were queued locally because ingestion was unavailable.`
        );
      } else {
        this.setMessage(`Session ${activeSessionId} was marked invalid. You can start a fresh managed session now.`);
      }
    } catch (error) {
      this.setError(this.formatError("Failed to abandon the managed session", error));
    }
  }

  async endSessionAndScore(): Promise<void> {
    if (!this.sessionId || !this.activeSession) {
      this.setMessage("There is no active managed session to end.");
      return;
    }

    const readiness = deriveDesktopReadiness(this.sessionDetail, this.launchInProgress);
    if (!readiness.canScore) {
      this.setError(`The session is not ready to score yet. ${readiness.reason}`);
      return;
    }

    const activeSessionId = this.sessionId;
    this.stopHeartbeatLoop();
    this.stopSessionPollLoop();
    this.launchInProgress = false;

    try {
      const delivery = await this.sendEvent("session.ended", "session", {
        status: "submitted"
      });
      if (delivery === "spooled" || this.hasPendingSpool) {
        this.activeSession = false;
        this.sessionStatus = "active";
        this.browserLaunchRequested = false;
        this.browserLaunched = false;
        this.setError(
          "Ingestion is unavailable, so the session end event was queued locally. The session was not submitted or scored."
        );
        return;
      }

      await this.fetchJson<SessionSummary>(`${controlPlaneUrl}/api/sessions/${activeSessionId}/status`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({ status: "submitted" })
      });

      this.sessionStatus = "submitted";
      await this.syncSessionDetail();
      const scoreResult = await this.fetchJson<ScoreSessionResponse>(`${controlPlaneUrl}/api/sessions/${activeSessionId}/score`, {
        method: "POST"
      });

      this.activeSession = false;
      this.launchInProgress = false;
      this.browserLaunchRequested = false;
      this.browserLaunched = false;
      this.sessionStatus = scoreResult.session.status;
      this.scoringSummary = {
        haciScore: scoreResult.scoring.haci_score,
        predictedArchetype: scoreResult.scoring.predicted_archetype
      };
      this.reviewerSessionUrl = `${reviewerUrl}?sessionId=${activeSessionId}`;
      await this.syncSessionDetail();
      this.setMessage(
        `Session ${activeSessionId} scored successfully. HACI ${scoreResult.scoring.haci_score}, archetype ${scoreResult.scoring.predicted_archetype}.`
      );
    } catch (error) {
      this.activeSession = false;
      this.launchInProgress = false;
      this.browserLaunchRequested = false;
      this.browserLaunched = false;
      this.setError(this.formatError("Failed to end and score the managed session", error));
    }
  }

  async openReviewer(): Promise<void> {
    await shell.openExternal(this.reviewerSessionUrl ?? reviewerUrl);
  }

  private async promptForWorkspacePath(window: BrowserWindow): Promise<string | null> {
    const folderSelection = await dialog.showOpenDialog(window, {
      title: "Choose Workspace Folder",
      properties: ["openDirectory"]
    });

    if (folderSelection.canceled || folderSelection.filePaths.length === 0) {
      this.setMessage("Session start cancelled before a workspace was selected.");
      return null;
    }

    return folderSelection.filePaths[0] ?? null;
  }

  private async fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, init);
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
    }
    return response.json() as Promise<T>;
  }

  private getSelectedManifest(): SessionManifest | null {
    return selectPreferredManifest(this.manifestInventory, this.selectedManifestId, preferredManifestId);
  }

  private async maybeAutoStartManagedSession(window: BrowserWindow): Promise<void> {
    if (!shouldAutoStartManagedSession({
      autoStartWorkspacePath,
      autoStartTriggered: this.autoStartTriggered,
      activeSession: this.activeSession,
      launchInProgress: this.launchInProgress
    })) {
      return;
    }

    this.autoStartTriggered = true;

    try {
      await access(autoStartWorkspacePath!, fsConstants.F_OK);
    } catch {
      this.setError(
        `Auto-start workspace not found at ${autoStartWorkspacePath}. Update ASSESSMENT_AUTO_START_WORKSPACE before retrying.`
      );
      return;
    }

    this.setMessage(`Auto-starting a managed session for ${autoStartWorkspacePath}.`);
    setTimeout(() => {
      void this.startManagedSession(window, autoStartWorkspacePath!).catch((error) => {
        this.setError(this.formatError("Failed to auto-start the managed session", error));
      });
    }, autoStartDelayMs);
  }

  private maybeAutoEndAndScore(): void {
    if (!autoEndWhenReady || this.autoEndTriggered || !this.activeSession || this.launchInProgress) {
      return;
    }

    const readiness = deriveDesktopReadiness(this.sessionDetail, this.launchInProgress);
    if (!readiness.canScore) {
      return;
    }

    this.autoEndTriggered = true;
    this.setMessage(`All required streams are present. Auto-ending and scoring session ${this.sessionId}.`);
    setTimeout(() => {
      void this.endSessionAndScore();
    }, autoEndDelayMs);
  }

  private async refreshManifestInventory(): Promise<void> {
    const manifests = await this.fetchJson<SessionManifest[]>(`${controlPlaneUrl}/api/manifests`);
    this.manifestInventory = manifests;
    const selectedManifest = selectPreferredManifest(manifests, this.selectedManifestId, preferredManifestId);
    this.selectedManifestId = selectedManifest?.id ?? null;
    if (!this.sessionId) {
      this.manifestName = selectedManifest?.name ?? null;
    }
    this.onChange();
  }

  private async safeInvalidateSession(sessionId: string): Promise<void> {
    try {
      await this.fetchJson<SessionSummary>(`${controlPlaneUrl}/api/sessions/${sessionId}/status`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({ status: "invalid" })
      });
    } catch {
      // Best effort only.
    }
  }

  private async syncSessionDetail(): Promise<void> {
    if (!this.sessionId) {
      this.sessionDetail = null;
      return;
    }

    const detail = await this.fetchJson<SessionDetail>(`${controlPlaneUrl}/api/sessions/${this.sessionId}`);
    this.sessionDetail = detail;
    this.manifestName = detail.manifest_name;
    this.sessionStatus = detail.status;
    if (detail.status === "scored" || detail.status === "invalid") {
      this.activeSession = false;
      this.launchInProgress = false;
      this.browserLaunchRequested = false;
      this.browserLaunched = false;
      this.stopHeartbeatLoop();
      this.stopSessionPollLoop();
    }
    this.onChange();
    this.maybeAutoEndAndScore();
  }

  private startSessionPollLoop(): void {
    this.stopSessionPollLoop();
    this.sessionPollTimer = setInterval(() => {
      void this.syncSessionDetail().catch((error) => {
        console.error("Failed to poll session detail", error);
      });
    }, 2_500);
  }

  private stopSessionPollLoop(): void {
    if (this.sessionPollTimer) {
      clearInterval(this.sessionPollTimer);
      this.sessionPollTimer = null;
    }
  }

  private async resolveVsCodeExecutable(): Promise<string> {
    const resolvePreferredWindowsExecutable = async (executablePath: string): Promise<string> => {
      if (process.platform !== "win32" || !isWindowsBatchScript(executablePath)) {
        return executablePath;
      }
      const nativeExecutablePath = deriveWindowsNativeVsCodeExecutablePath(executablePath);
      if (!nativeExecutablePath) {
        return executablePath;
      }
      try {
        await access(nativeExecutablePath, fsConstants.F_OK);
        return nativeExecutablePath;
      } catch {
        return executablePath;
      }
    };

    const configured = process.env.VSCODE_EXECUTABLE?.trim();
    if (configured) {
      if (path.isAbsolute(configured)) {
        await access(configured, fsConstants.F_OK);
        return resolvePreferredWindowsExecutable(configured);
      }
      const resolved = await resolveExecutableOnPath(configured);
      if (resolved) {
        return resolvePreferredWindowsExecutable(resolved);
      }
      throw new Error(`The configured VS Code executable "${configured}" could not be resolved.`);
    }

    const resolvedDefault = await resolveExecutableOnPath(defaultVsCodeExecutable) ?? await resolveExecutableOnPath("code");
    if (!resolvedDefault) {
      throw new Error(
        'Could not find VS Code on PATH. Set the VSCODE_EXECUTABLE environment variable to "code.cmd" or an absolute Code.exe path.'
      );
    }
    return resolvePreferredWindowsExecutable(resolvedDefault);
  }

  private async resolveEdgeExecutable(): Promise<string> {
    const configured = process.env.EDGE_EXECUTABLE?.trim();
    const edgeCandidates = [
      configured,
      defaultEdgeExecutable,
      "msedge",
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
      "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"
    ].filter((candidate): candidate is string => Boolean(candidate));

    for (const candidate of edgeCandidates) {
      try {
        if (path.isAbsolute(candidate)) {
          await access(candidate, fsConstants.F_OK);
          return candidate;
        }

        const resolved = await resolveExecutableOnPath(candidate);
        if (resolved) {
          return resolved;
        }
      } catch {
        // Try the next candidate.
      }
    }

    throw new Error(
      'Could not find Microsoft Edge. Set the EDGE_EXECUTABLE environment variable to "msedge.exe" or an absolute path.'
    );
  }

  private async resolveVsCodeExtensionDevelopmentPath(): Promise<string> {
    const extensionDevelopmentPath = path.resolve(defaultVsCodeExtensionDevelopmentPath);
    try {
      await access(extensionDevelopmentPath, fsConstants.F_OK);
      await access(path.join(extensionDevelopmentPath, "dist", "extension.js"), fsConstants.F_OK);
      return extensionDevelopmentPath;
    } catch {
      throw new Error(
        `The local VS Code assessment extension is not ready at ${extensionDevelopmentPath}. Run the workspace build so dist/extension.js exists.`
      );
    }
  }

  private async resolveEdgeExtensionPath(): Promise<string> {
    const extensionPath = path.resolve(defaultEdgeExtensionPath);
    try {
      await access(extensionPath, fsConstants.F_OK);
      await access(path.join(extensionPath, "dist", "background.js"), fsConstants.F_OK);
      await access(path.join(extensionPath, "manifest.json"), fsConstants.F_OK);
      return extensionPath;
    } catch {
      throw new Error(
        `The local Edge assessment extension is not ready at ${extensionPath}. Run the workspace build so dist/background.js exists.`
      );
    }
  }

  private async launchVsCode(workspacePath: string): Promise<void> {
    const launchArgs = [
      "--new-window",
      "--extensionDevelopmentPath",
      this.resolvedVsCodeExtensionDevelopmentPath ?? defaultVsCodeExtensionDevelopmentPath,
      workspacePath
    ];

    const launchEnv = {
      ...process.env,
      CONTROL_PLANE_URL: controlPlaneUrl,
      INGESTION_URL: ingestionBaseUrl,
      ASSESSMENT_SESSION_ID: this.sessionId ?? "",
      ASSESSMENT_EVENT_ENDPOINT: ingestionEventEndpoint,
      ASSESSMENT_CONTROL_PLANE_URL: controlPlaneUrl
    };

    await new Promise<void>((resolve, reject) => {
      const child =
        process.platform === "win32" && isWindowsBatchScript(this.resolvedVsCodeExecutable)
          ? spawn(
              process.env.ComSpec ?? "cmd.exe",
              ["/d", "/s", "/c", [this.resolvedVsCodeExecutable, ...launchArgs].map(quoteForCmd).join(" ")],
              {
                env: launchEnv,
                detached: true,
                stdio: "ignore",
                windowsHide: false
              }
            )
          : spawn(this.resolvedVsCodeExecutable, launchArgs, {
              env: launchEnv,
              detached: true,
              stdio: "ignore"
            });

      child.once("error", reject);
      child.once("spawn", () => {
        child.unref();
        resolve();
      });
    });
  }

  private async launchManagedBrowser(sessionId: string): Promise<void> {
    const bootstrapUrl = `${controlPlaneUrl}/browser-bootstrap?sessionId=${encodeURIComponent(sessionId)}`;
    const extensionPath = this.resolvedEdgeExtensionPath ?? defaultEdgeExtensionPath;
    const profilePath = path.join(browserProfilesDir, sessionId);
    await mkdir(profilePath, { recursive: true });

    const launchArgs = buildManagedBrowserLaunchArgs(profilePath, extensionPath, bootstrapUrl);

    await new Promise<void>((resolve, reject) => {
      const child = spawn(this.resolvedEdgeExecutable, launchArgs, {
        env: {
          ...process.env,
          ASSESSMENT_SESSION_ID: sessionId,
          ASSESSMENT_CONTROL_PLANE_URL: controlPlaneUrl
        },
        detached: true,
        stdio: "ignore"
      });

      child.once("error", reject);
      child.once("spawn", () => {
        child.unref();
        resolve();
      });
    });
  }

  private startHeartbeatLoop(): void {
    this.stopHeartbeatLoop();
    this.heartbeatTimer = setInterval(() => {
      void this.sendHeartbeat();
    }, 30_000);
  }

  private stopHeartbeatLoop(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private async sendEvent(eventType: string, artifactRef: string, payload: Record<string, unknown>): Promise<SessionEventDelivery> {
    if (!this.sessionId) {
      throw new Error("No active session is available for desktop event publishing.");
    }

    this.sequenceNo += 1;
    const event = {
      event_id: crypto.randomUUID(),
      session_id: this.sessionId,
      timestamp_utc: new Date().toISOString(),
      source: "desktop",
      event_type: eventType,
      sequence_no: this.sequenceNo,
      artifact_ref: artifactRef,
      payload,
      client_version: "0.1.0",
      integrity_hash: crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
      policy_context: {
        managed_session: true
      }
    };

    try {
      const response = await fetch(ingestionEventEndpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({ event })
      });
      if (!response.ok) {
        throw new Error(`Ingestion rejected desktop event: ${response.status} ${response.statusText} ${await response.text()}`);
      }
      return "sent";
    } catch (error) {
      if (!this.isRecoverableIngestionFailure(error)) {
        throw error;
      }
      this.hasPendingSpool = true;
      await mkdir(spoolDir, { recursive: true });
      await appendFile(path.join(spoolDir, `${this.sessionId}.ndjson`), JSON.stringify(event) + "\n", "utf8");
      return "spooled";
    }
  }

  private isRecoverableIngestionFailure(error: unknown): boolean {
    if (error instanceof TypeError) {
      return true;
    }
    if (error instanceof Error) {
      return /fetch failed|ECONNREFUSED|ENOTFOUND|network/i.test(error.message);
    }
    return false;
  }

  private formatError(prefix: string, error: unknown): string {
    const detail = error instanceof Error ? error.message : String(error);
    return `${prefix}. ${detail}`;
  }

  private setMessage(message: string): void {
    this.latestMessage = message;
    this.latestError = null;
    this.onChange();
  }

  private setError(message: string): void {
    this.latestError = message;
    this.latestMessage = null;
    this.onChange();
  }
}

let windowRef: BrowserWindow | null = null;

const runtime = new DesktopSessionRuntime(() => {
  void renderWindow();
});

const buildHtml = (viewModel: DesktopViewModel) => {
  const message = viewModel.latestMessage
    ? `<div style="padding:14px 16px; border-radius:14px; background:#102a43; color:#d9e2ec;">${escapeHtml(viewModel.latestMessage)}</div>`
    : "";
  const error = viewModel.latestError
    ? `<div style="padding:14px 16px; border-radius:14px; background:#7f1d1d; color:#fee2e2;">${escapeHtml(viewModel.latestError)}</div>`
    : "";
  const scoringSummary = viewModel.scoringSummary
    ? `<p style="margin:8px 0 0;">Latest score: HACI ${viewModel.scoringSummary.haciScore}, ${escapeHtml(viewModel.scoringSummary.predictedArchetype)}</p>`
    : "<p style=\"margin:8px 0 0;\">No scored live session yet.</p>";
  const streamList = (items: string[]) => (items.length ? items.map((item) => escapeHtml(item)).join(", ") : "None");
  const manifestOptions = viewModel.availableManifests.length
    ? viewModel.availableManifests.map((manifest) => `
        <option value="${escapeHtml(manifest.id)}" ${manifest.id === viewModel.selectedManifestId ? "selected" : ""}>
          ${escapeHtml(manifest.name)}
        </option>
      `).join("")
    : "<option value=\"\">Loading manifests from the control plane...</option>";
  const manifestPickerDisabled = viewModel.manifestPickerDisabled || viewModel.availableManifests.length === 0;

  return `
<!doctype html>
<html lang="en">
  <body style="font-family: Segoe UI, sans-serif; background:linear-gradient(165deg, #0f172a, #1e293b 55%, #312e81); color:#e2e8f0; margin:0;">
    <main style="padding:24px; display:grid; gap:18px; max-width:1100px; margin:0 auto;">
      <header style="display:grid; gap:10px;">
        <p style="letter-spacing:0.18em; text-transform:uppercase; font-size:12px; margin:0; color:#cbd5e1;">Desktop Controller</p>
        <h1 style="margin:0; font-size:42px;">Real Managed Session Launcher</h1>
        <p style="margin:0; max-width:820px; color:#cbd5e1;">
          This desktop controller now owns the live session ID, launches VS Code with injected telemetry context,
          sends desktop lifecycle events, and scores the session on end without touching the fixture replay path.
        </p>
      </header>
      ${message}
      ${error}
      <section style="display:flex; gap:12px; flex-wrap:wrap;">
        <button onclick="window.location.href='assessment://start'" ${viewModel.activeSession ? "disabled" : ""} style="padding:12px 18px;">Start Live Session</button>
        <button onclick="window.location.href='assessment://heartbeat'" ${viewModel.activeSession ? "" : "disabled"} style="padding:12px 18px;">Send Heartbeat</button>
        <button onclick="window.location.href='assessment://end'" ${viewModel.activeSession && viewModel.canScoreSession ? "" : "disabled"} style="padding:12px 18px;">End And Score Session</button>
        <button onclick="window.location.href='assessment://abandon'" ${viewModel.canAbandonSession ? "" : "disabled"} style="padding:12px 18px;">Abandon Session</button>
        <button onclick="window.location.href='assessment://open-reviewer'" style="padding:12px 18px;">Open Reviewer</button>
        <button onclick="window.location.href='assessment://open-control-plane'" style="padding:12px 18px;">Open Control Plane</button>
      </section>
      <section style="display:grid; gap:16px; grid-template-columns:repeat(auto-fit, minmax(260px, 1fr));">
        <article style="background:rgba(15,23,42,0.55); border-radius:18px; padding:18px;">
          <h2 style="margin-top:0;">Manifest Selection</h2>
          <p style="margin:0 0 12px; color:#cbd5e1;">Pick the live workflow before starting a session. The picker locks while a managed session is active.</p>
          <label for="manifest-picker" style="display:block; margin:0 0 8px;">Selected manifest</label>
          <select
            id="manifest-picker"
            ${manifestPickerDisabled ? "disabled" : ""}
            onchange="window.location.href='assessment://select-manifest?manifestId=' + encodeURIComponent(this.value)"
            style="width:100%; padding:10px 12px; border-radius:12px; border:1px solid rgba(148,163,184,0.35); background:#0f172a; color:#e2e8f0;"
          >
            ${manifestOptions}
          </select>
          <p style="margin:12px 0 8px;">Manifest name: ${escapeHtml(viewModel.selectedManifestName ?? "Loading manifests")}</p>
          <p style="margin:0 0 8px;">Required streams for next run: ${streamList(viewModel.selectedManifestRequiredStreams)}</p>
          <p style="margin:0;">Picker locked: ${viewModel.manifestPickerDisabled ? "yes" : "no"}</p>
        </article>
        <article style="background:rgba(15,23,42,0.55); border-radius:18px; padding:18px;">
          <h2 style="margin-top:0;">Session State</h2>
          <p style="margin:0 0 8px;">Backend status: ${escapeHtml(viewModel.sessionStatus)}</p>
          <p style="margin:0 0 8px;">Readiness: ${escapeHtml(viewModel.readinessState)}</p>
          <p style="margin:0 0 8px;">Session ID: ${escapeHtml(viewModel.sessionId ?? "Not started")}</p>
          <p style="margin:0 0 8px;">Manifest: ${escapeHtml(viewModel.manifestName ?? "Pending selection")}</p>
          <p style="margin:0 0 8px;">Reason: ${escapeHtml(viewModel.readinessReason)}</p>
          <p style="margin:0;">Heartbeat loop: ${viewModel.heartbeatActive ? "running" : "stopped"}</p>
        </article>
        <article style="background:rgba(15,23,42,0.55); border-radius:18px; padding:18px;">
          <h2 style="margin-top:0;">Browser Capture</h2>
          <p style="margin:0 0 8px;">State: ${escapeHtml(viewModel.browserStatusState)}</p>
          <p style="margin:0 0 8px;">Reason: ${escapeHtml(viewModel.browserStatusReason)}</p>
          <p style="margin:0;">The full live manifest now waits for session-scoped browser bootstrap before the score button can unlock.</p>
        </article>
      </section>
      <section style="display:grid; gap:16px; grid-template-columns:repeat(auto-fit, minmax(260px, 1fr));">
        <article style="background:rgba(15,23,42,0.55); border-radius:18px; padding:18px;">
          <h2 style="margin-top:0;">Workspace + Tooling</h2>
          <p style="margin:0 0 8px;">Workspace: ${escapeHtml(viewModel.workspacePath ?? "Choose a folder when starting a session.")}</p>
          <p style="margin:0 0 8px;">VS Code executable: ${escapeHtml(viewModel.usingVsCodeExecutable)}</p>
          <p style="margin:0 0 8px;">Edge executable: ${escapeHtml(viewModel.usingEdgeExecutable)}</p>
          <p style="margin:0;">Desktop spool pending: ${viewModel.hasPendingSpool ? "yes" : "no"}</p>
        </article>
        <article style="background:rgba(15,23,42,0.55); border-radius:18px; padding:18px;">
          <h2 style="margin-top:0;">Scoring</h2>
          ${scoringSummary}
          <p style="margin:8px 0 0;">Reviewer URL: ${escapeHtml(viewModel.reviewerSessionUrl ?? reviewerUrl)}</p>
        </article>
        <article style="background:rgba(15,23,42,0.55); border-radius:18px; padding:18px;">
          <h2 style="margin-top:0;">Completeness</h2>
          <p style="margin:0 0 8px;">Required streams: ${streamList(viewModel.requiredStreams)}</p>
          <p style="margin:0 0 8px;">Present streams: ${streamList(viewModel.presentStreams)}</p>
          <p style="margin:0;">Missing streams: ${streamList(viewModel.missingStreams)}</p>
        </article>
        <article style="background:rgba(15,23,42,0.55); border-radius:18px; padding:18px;">
          <h2 style="margin-top:0;">Operator Guidance</h2>
          <p style="margin:0 0 8px;">Score button enabled: ${viewModel.canScoreSession ? "yes" : "no"}</p>
          <p style="margin:0 0 8px;">Abandon session enabled: ${viewModel.canAbandonSession ? "yes" : "no"}</p>
          <p style="margin:0;">The controller polls session detail and unlocks scoring only after every required non-desktop stream has at least one ingested event.</p>
        </article>
      </section>
      <section style="background:rgba(15,23,42,0.55); border-radius:18px; padding:18px;">
        <h2 style="margin-top:0;">Sprint Notes</h2>
        <ul style="margin:0; padding-left:20px;">
          <li>Fixture replay remains untouched as the regression baseline.</li>
          <li>Desktop sessions now poll the control plane for readiness, stream completeness, and invalidation outcomes.</li>
          <li>The full live manifest can now bootstrap a managed Edge profile with a session-scoped extension context.</li>
          <li>The desktop controller now exposes a manifest picker, explicit browser readiness, and an operator reset path for stuck live sessions.</li>
          <li>Provider-specific browser prompt/response capture is additive evidence only and does not change stream-completeness gating.</li>
        </ul>
      </section>
    </main>
  </body>
</html>
`;
};

async function renderWindow(): Promise<void> {
  if (!windowRef || windowRef.isDestroyed()) {
    return;
  }
  try {
    await windowRef.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(buildHtml(runtime.getViewModel()))}`);
  } catch (error) {
    if (!isAbortedWindowLoad(error)) {
      console.error("Failed to render desktop controller window", error);
    }
  }
}

const createWindow = async () => {
  windowRef = new BrowserWindow({
    width: 1180,
    height: 840,
    webPreferences: {
      devTools: true
    }
  });

  await renderWindow();
  await runtime.initialize(windowRef);

  windowRef.webContents.on("will-navigate", async (event, url) => {
    event.preventDefault();
    const parsedUrl = new URL(url);
    const action = parsedUrl.hostname;

    if (action === "start") {
      await runtime.startManagedSession(windowRef!);
    }
    if (action === "heartbeat") {
      await runtime.sendHeartbeat();
    }
    if (action === "end") {
      await runtime.endSessionAndScore();
    }
    if (action === "abandon") {
      await runtime.abandonManagedSession();
    }
    if (action === "select-manifest") {
      const manifestId = parsedUrl.searchParams.get("manifestId");
      if (manifestId) {
        await runtime.selectManifest(manifestId);
      }
    }
    if (action === "open-reviewer") {
      await runtime.openReviewer();
    }
    if (action === "open-control-plane") {
      await shell.openExternal(controlPlaneUrl);
    }
  });
};

app.whenReady().then(createWindow).catch((error) => {
  console.error(error);
  process.exit(1);
});
