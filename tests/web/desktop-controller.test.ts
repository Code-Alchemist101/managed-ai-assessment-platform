import test from "node:test";
import assert from "node:assert/strict";
import {
  buildManagedBrowserLaunchArgs,
  defaultDesktopManifestId,
  deriveBrowserCaptureStatus,
  deriveCanAbandonSession,
  deriveDesktopReadiness,
  deriveManifestPickerDisabled,
  deriveWindowsNativeVsCodeExecutablePath,
  guardStartManagedSession,
  normalizeIngestionEventEndpoint,
  resolveAutoStartWorkspacePath,
  selectPreferredManifest,
  shouldAutoStartManagedSession
} from "../../apps/desktop-controller/src/session-helpers";

test("desktop controller normalizes ingestion endpoints", () => {
  assert.equal(normalizeIngestionEventEndpoint("http://127.0.0.1:4020"), "http://127.0.0.1:4020/api/events");
  assert.equal(
    normalizeIngestionEventEndpoint("http://127.0.0.1:4020/api/events"),
    "http://127.0.0.1:4020/api/events"
  );
});

test("desktop controller prefers native Code.exe when starting from code.cmd", () => {
  assert.equal(
    deriveWindowsNativeVsCodeExecutablePath("C:\\Users\\hosan\\AppData\\Local\\Programs\\Microsoft VS Code\\bin\\code.cmd"),
    "C:\\Users\\hosan\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe"
  );
  assert.equal(deriveWindowsNativeVsCodeExecutablePath("C:\\Tools\\custom.exe"), null);
});

test("desktop controller start guard blocks duplicate live sessions", () => {
  assert.equal(
    guardStartManagedSession(true),
    "A managed session is already active. End the current session before starting another."
  );
  assert.equal(guardStartManagedSession(false), null);
});

test("desktop controller readiness gating waits for required non-desktop streams", () => {
  const awaitingIde = deriveDesktopReadiness({
    status: "active",
    required_streams: ["desktop", "ide"],
    event_counts_by_source: {
      desktop: 3
    },
    missing_streams: ["ide"],
    integrity_verdict: null
  });

  assert.equal(awaitingIde.state, "awaiting_ide_stream");
  assert.equal(awaitingIde.canScore, false);

  const awaitingBrowser = deriveDesktopReadiness({
    status: "active",
    required_streams: ["desktop", "ide", "browser"],
    event_counts_by_source: {
      desktop: 3,
      ide: 10
    },
    missing_streams: ["browser"],
    integrity_verdict: null
  });

  assert.equal(awaitingBrowser.state, "awaiting_browser_stream");
  assert.equal(awaitingBrowser.canScore, false);

  const awaitingMultipleStreams = deriveDesktopReadiness({
    status: "active",
    required_streams: ["desktop", "ide", "browser"],
    event_counts_by_source: {
      desktop: 3
    },
    missing_streams: ["ide", "browser"],
    integrity_verdict: null
  });

  assert.equal(awaitingMultipleStreams.state, "awaiting_live_streams");
  assert.match(awaitingMultipleStreams.reason, /ide, browser/);

  const readyToScore = deriveDesktopReadiness({
    status: "active",
    required_streams: ["desktop", "ide", "browser"],
    event_counts_by_source: {
      desktop: 3,
      ide: 10,
      browser: 2
    },
    missing_streams: [],
    integrity_verdict: null
  });

  assert.equal(readyToScore.state, "ready_to_score");
  assert.equal(readyToScore.canScore, true);
});

test("desktop controller selects manifests with env preference and default fallback", () => {
  const manifests = [
    {
      id: "manifest-python-cli-live-desktop-ide",
      name: "Desktop + IDE",
      required_streams: ["desktop", "ide"]
    },
    {
      id: "manifest-python-cli-live-full",
      name: "Desktop + IDE + Edge",
      required_streams: ["desktop", "ide", "browser"]
    }
  ];

  assert.equal(
    selectPreferredManifest(manifests, "manifest-python-cli-live-full")?.id,
    "manifest-python-cli-live-full"
  );
  assert.equal(
    selectPreferredManifest(manifests, "missing-manifest", defaultDesktopManifestId)?.id,
    "manifest-python-cli-live-desktop-ide"
  );
});

test("desktop controller locks manifest changes during active sessions and enables abandon recovery", () => {
  assert.equal(deriveManifestPickerDisabled(true, false), true);
  assert.equal(deriveManifestPickerDisabled(false, true), true);
  assert.equal(deriveManifestPickerDisabled(false, false), false);
  assert.equal(deriveCanAbandonSession(true), true);
  assert.equal(deriveCanAbandonSession(false), false);
});

test("desktop controller auto-start helpers normalize workspace paths and avoid duplicate auto-launch", () => {
  assert.equal(
    resolveAutoStartWorkspacePath("C:\\Users\\hosan\\Desktop\\Research Project\\Test_folder"),
    "C:\\Users\\hosan\\Desktop\\Research Project\\Test_folder"
  );
  assert.equal(resolveAutoStartWorkspacePath("   "), null);

  assert.equal(
    shouldAutoStartManagedSession({
      autoStartWorkspacePath: "C:\\Users\\hosan\\Desktop\\Research Project\\Test_folder",
      autoStartTriggered: false,
      activeSession: false,
      launchInProgress: false
    }),
    true
  );
  assert.equal(
    shouldAutoStartManagedSession({
      autoStartWorkspacePath: "C:\\Users\\hosan\\Desktop\\Research Project\\Test_folder",
      autoStartTriggered: true,
      activeSession: false,
      launchInProgress: false
    }),
    false
  );
});

test("desktop controller surfaces explicit browser capture status", () => {
  const awaitingBrowser = deriveBrowserCaptureStatus(
    {
      id: "manifest-python-cli-live-full",
      name: "Desktop + IDE + Edge",
      required_streams: ["desktop", "ide", "browser"]
    },
    {
      status: "active",
      required_streams: ["desktop", "ide", "browser"],
      event_counts_by_source: {
        desktop: 3,
        ide: 1
      },
      missing_streams: ["browser"],
      integrity_verdict: null
    },
    true,
    true,
    true
  );

  assert.equal(awaitingBrowser.state, "awaiting_browser_stream");
  assert.match(awaitingBrowser.reason, /bootstrap page/);

  const browserReady = deriveBrowserCaptureStatus(
    {
      id: "manifest-python-cli-live-full",
      name: "Desktop + IDE + Edge",
      required_streams: ["desktop", "ide", "browser"]
    },
    {
      status: "active",
      required_streams: ["desktop", "ide", "browser"],
      event_counts_by_source: {
        desktop: 3,
        ide: 1,
        browser: 2
      },
      missing_streams: [],
      integrity_verdict: null
    },
    true,
    true,
    true
  );

  assert.equal(browserReady.state, "telemetry_live");
});

test("desktop controller launches managed Edge without first-run onboarding", () => {
  const launchArgs = buildManagedBrowserLaunchArgs(
    "C:\\assessment\\browser-profile",
    "C:\\assessment\\edge-extension",
    "http://127.0.0.1:4010/browser-bootstrap?sessionId=session-123"
  );

  assert.deepEqual(launchArgs, [
    "--new-window",
    "--no-first-run",
    "--no-default-browser-check",
    "--user-data-dir=C:\\assessment\\browser-profile",
    "--disable-extensions-except=C:\\assessment\\edge-extension",
    "--load-extension=C:\\assessment\\edge-extension",
    "http://127.0.0.1:4010/browser-bootstrap?sessionId=session-123"
  ]);
});
