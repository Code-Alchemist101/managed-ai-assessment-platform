import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
import type { AddressInfo } from "node:net";
import { buildIngestionApp } from "../../services/ingestion-api/src/app";
import { buildControlPlaneApp } from "../../services/control-plane-api/src/app";
import type { ControlPlaneRuntime } from "../../services/control-plane-api/src/runtime";

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Could not determine an open port."));
        return;
      }
      server.close(() => resolve(address.port));
    });
    server.on("error", reject);
  });
}

async function waitForHealthy(url: string): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 20_000) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Retry until timeout.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function spawnAnalytics(repoRoot: string, port: number): ChildProcess {
  return spawn(
    "python",
    [
      "-m",
      "uvicorn",
      "assessment_analytics.app:app",
      "--app-dir",
      path.join(repoRoot, "services", "analytics-py"),
      "--host",
      "127.0.0.1",
      "--port",
      String(port)
    ],
    {
      cwd: repoRoot,
      stdio: "ignore"
    }
  );
}

function buildEvent(
  sessionId: string,
  source: "desktop" | "ide" | "browser",
  eventType: string,
  sequenceNo: number,
  timestampUtc: string,
  artifactRef: string,
  payload: Record<string, unknown>
) {
  return {
    event_id: `${source}-${sequenceNo}-${sessionId}`,
    session_id: sessionId,
    timestamp_utc: timestampUtc,
    source,
    event_type: eventType,
    sequence_no: sequenceNo,
    artifact_ref: artifactRef,
    payload,
    client_version: "0.1.0",
    integrity_hash: `hash-${source}-${sequenceNo}`,
    policy_context: {
      managed_session: true
    }
  };
}

async function setupLocalApps(t: test.TestContext) {
  const repoRoot = path.resolve(process.cwd());
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "assessment-platform-live-"));
  const analyticsPort = await getFreePort();
  const analytics = spawnAnalytics(repoRoot, analyticsPort);

  t.after(async () => {
    if (!analytics.killed) {
      analytics.kill();
    }
    await rm(dataRoot, { recursive: true, force: true });
  });

  await waitForHealthy(`http://127.0.0.1:${analyticsPort}/health`);

  const ingestionApp = await buildIngestionApp({
    host: "127.0.0.1",
    port: 0,
    dataRoot,
    sessionsDir: path.join(dataRoot, "ingestion", "sessions")
  });
  await ingestionApp.listen({ port: 0, host: "127.0.0.1" });
  t.after(async () => {
    await ingestionApp.close();
  });
  const ingestionPort = (ingestionApp.server.address() as AddressInfo).port;

  const runtime: ControlPlaneRuntime = {
    host: "127.0.0.1",
    port: 0,
    controlPlaneUrl: "http://127.0.0.1:4010",
    ingestionUrl: `http://127.0.0.1:${ingestionPort}`,
    analyticsUrl: `http://127.0.0.1:${analyticsPort}`,
    reviewerUrl: "http://127.0.0.1:4173",
    adminUrl: "http://127.0.0.1:4174",
    repoRoot,
    dataRoot,
    storageDir: path.join(dataRoot, "control-plane"),
    manifestsFile: path.join(dataRoot, "control-plane", "manifests.json"),
    sessionsFile: path.join(dataRoot, "control-plane", "sessions.json"),
    scoringsDir: path.join(dataRoot, "control-plane", "scorings"),
    reviewDecisionsDir: path.join(dataRoot, "control-plane", "review-decisions"),
    ingestionSessionsDir: path.join(dataRoot, "ingestion", "sessions"),
    fixturePath: path.join(repoRoot, "fixtures", "sample-session.json")
  };

  const controlPlaneApp = await buildControlPlaneApp(runtime);
  t.after(async () => {
    await controlPlaneApp.close();
  });

  return { controlPlaneApp, runtime };
}

async function createSession(
  controlPlaneApp: Awaited<ReturnType<typeof buildControlPlaneApp>>,
  manifestId: string,
  candidateId: string
): Promise<{ id: string }> {
  const createSessionResponse = await controlPlaneApp.inject({
    method: "POST",
    url: "/api/sessions",
    payload: {
      manifest_id: manifestId,
      candidate_id: candidateId
    }
  });
  assert.equal(createSessionResponse.statusCode, 200);
  const session = createSessionResponse.json() as { id: string };

  const activeResponse = await controlPlaneApp.inject({
    method: "POST",
    url: `/api/sessions/${session.id}/status`,
    payload: { status: "active" }
  });
  assert.equal(activeResponse.statusCode, 200);
  return session;
}

async function ingestEvents(ingestionUrl: string, events: ReturnType<typeof buildEvent>[]): Promise<void> {
  const response = await fetch(`${ingestionUrl}/api/events`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({ events })
  });
  assert.equal(response.status, 200);
}

async function submitAndScore(
  controlPlaneApp: Awaited<ReturnType<typeof buildControlPlaneApp>>,
  sessionId: string
): Promise<{
  session: { status: string; id: string };
  scoring: { integrity: { verdict: string; missing_streams: string[] } };
}> {
  const submitResponse = await controlPlaneApp.inject({
    method: "POST",
    url: `/api/sessions/${sessionId}/status`,
    payload: { status: "submitted" }
  });
  assert.equal(submitResponse.statusCode, 200);

  const scoreResponse = await controlPlaneApp.inject({
    method: "POST",
    url: `/api/sessions/${sessionId}/score`
  });
  assert.equal(scoreResponse.statusCode, 200);
  return scoreResponse.json() as {
    session: { status: string; id: string };
    scoring: { integrity: { verdict: string; missing_streams: string[] } };
  };
}

test("live desktop + ide session scores clean with enriched session detail", async (t) => {
  const { controlPlaneApp, runtime } = await setupLocalApps(t);
  const session = await createSession(controlPlaneApp, "manifest-python-cli-live-desktop-ide", "desktop-live");

  await ingestEvents(runtime.ingestionUrl, [
    buildEvent(session.id, "desktop", "session.started", 1, "2026-04-12T09:29:37.000Z", "session", { status: "active" }),
    buildEvent(session.id, "desktop", "desktop.workspace.selected", 2, "2026-04-12T09:29:38.000Z", "workspace:C:/repo", {
      workspace_path: "C:/repo"
    }),
    buildEvent(session.id, "desktop", "desktop.vscode.launched", 3, "2026-04-12T09:29:39.000Z", "workspace:C:/repo", {
      executable: "Code.exe"
    }),
    buildEvent(session.id, "desktop", "session.heartbeat", 4, "2026-04-12T09:30:00.000Z", "session", { status: "active" }),
    buildEvent(
      session.id,
      "ide",
      "ide.extension.activated",
      1,
      "2026-04-12T09:29:40.000Z",
      "extension:assessment-platform",
      { mode: "injected" }
    ),
    buildEvent(session.id, "ide", "ide.editor.focused", 2, "2026-04-12T09:30:01.000Z", "file:C:/repo/index.html", {
      language_id: "html"
    }),
    buildEvent(session.id, "ide", "ide.document.changed", 3, "2026-04-12T09:30:02.000Z", "file:C:/repo/index.html", {
      inserted_text: "<title>Hello</title>",
      inserted_chars: 20,
      deleted_chars: 0,
      change_source: "typing"
    }),
    buildEvent(session.id, "ide", "ide.document.saved", 4, "2026-04-12T09:30:03.000Z", "file:C:/repo/index.html", {
      version: 1
    })
  ]);

  const scored = await submitAndScore(controlPlaneApp, session.id);
  assert.equal(scored.session.status, "scored");
  assert.equal(scored.scoring.integrity.verdict, "clean");

  const detailResponse = await controlPlaneApp.inject({
    method: "GET",
    url: `/api/sessions/${session.id}`
  });
  assert.equal(detailResponse.statusCode, 200);
  const detail = detailResponse.json() as {
    event_counts_by_source: Record<string, number>;
    present_streams: string[];
    missing_streams: string[];
    integrity_verdict: string | null;
  };
  assert.deepEqual(detail.missing_streams, []);
  assert.ok(detail.event_counts_by_source.desktop > 0);
  assert.ok(detail.event_counts_by_source.ide > 0);
  assert.ok(detail.present_streams.includes("desktop"));
  assert.ok(detail.present_streams.includes("ide"));
  assert.equal(detail.integrity_verdict, "clean");
});

test("desktop-only live session is invalid when ide telemetry is missing", async (t) => {
  const { controlPlaneApp, runtime } = await setupLocalApps(t);
  const session = await createSession(controlPlaneApp, "manifest-python-cli-live-desktop-ide", "desktop-live");

  await ingestEvents(runtime.ingestionUrl, [
    buildEvent(session.id, "desktop", "session.started", 1, "2026-04-12T09:31:00.000Z", "session", { status: "active" }),
    buildEvent(session.id, "desktop", "desktop.workspace.selected", 2, "2026-04-12T09:31:01.000Z", "workspace:C:/repo", {
      workspace_path: "C:/repo"
    }),
    buildEvent(session.id, "desktop", "desktop.vscode.launch.requested", 3, "2026-04-12T09:31:02.000Z", "workspace:C:/repo", {
      requested_executable: "Code.exe"
    })
  ]);

  const scored = await submitAndScore(controlPlaneApp, session.id);
  assert.equal(scored.session.status, "invalid");
  assert.equal(scored.scoring.integrity.verdict, "invalid");
  assert.deepEqual(scored.scoring.integrity.missing_streams, ["ide"]);

  const detailResponse = await controlPlaneApp.inject({
    method: "GET",
    url: `/api/sessions/${session.id}`
  });
  assert.equal(detailResponse.statusCode, 200);
  const detail = detailResponse.json() as { missing_streams: string[]; integrity_verdict: string | null };
  assert.deepEqual(detail.missing_streams, ["ide"]);
  assert.equal(detail.integrity_verdict, "invalid");
});

test("full live manifest exposes browser bootstrap and scores clean with browser telemetry", async (t) => {
  const { controlPlaneApp, runtime } = await setupLocalApps(t);
  const session = await createSession(controlPlaneApp, "manifest-python-cli-live-full", "desktop-live");

  const bootstrapResponse = await controlPlaneApp.inject({
    method: "GET",
    url: `/api/sessions/${session.id}/bootstrap`
  });
  assert.equal(bootstrapResponse.statusCode, 200);
  const bootstrap = bootstrapResponse.json() as { required_streams: string[]; ingestion_event_endpoint: string };
  assert.deepEqual(bootstrap.required_streams, ["desktop", "ide", "browser"]);
  assert.equal(bootstrap.ingestion_event_endpoint, `${runtime.ingestionUrl}/api/events`);

  const bootstrapPageResponse = await controlPlaneApp.inject({
    method: "GET",
    url: `/browser-bootstrap?sessionId=${session.id}`
  });
  assert.equal(bootstrapPageResponse.statusCode, 200);
  assert.match(bootstrapPageResponse.body, /Edge Session Ready/);

  await ingestEvents(runtime.ingestionUrl, [
    buildEvent(session.id, "desktop", "session.started", 1, "2026-04-12T09:40:00.000Z", "session", { status: "active" }),
    buildEvent(session.id, "desktop", "desktop.vscode.launched", 2, "2026-04-12T09:40:01.000Z", "workspace:C:/repo", {
      executable: "Code.exe"
    }),
    buildEvent(session.id, "desktop", "session.heartbeat", 3, "2026-04-12T09:40:02.000Z", "session", { status: "active" }),
    buildEvent(
      session.id,
      "ide",
      "ide.extension.activated",
      1,
      "2026-04-12T09:40:03.000Z",
      "extension:assessment-platform",
      { mode: "injected" }
    ),
    buildEvent(session.id, "ide", "ide.document.saved", 2, "2026-04-12T09:40:04.000Z", "file:C:/repo/index.html", {
      version: 1
    }),
    buildEvent(session.id, "browser", "browser.navigation", 1, "2026-04-12T09:40:05.000Z", "tab:1", {
      url: `http://127.0.0.1:4010/browser-bootstrap?sessionId=${session.id}`,
      domain: "127.0.0.1",
      app_category: "browser",
      managed_bootstrap: true,
      allowed_site: true,
      policy_flag: null
    }),
    buildEvent(session.id, "browser", "browser.tab.activated", 2, "2026-04-12T09:40:06.000Z", "tab:1", {
      tab_id: 1
    }),
    buildEvent(session.id, "browser", "browser.ai.prompt", 3, "2026-04-12T09:40:07.000Z", "provider:openai", {
      provider: "openai",
      prompt_id: "prompt-1",
      prompt_text: "Explain how to structure the CLI commands.",
      prompt_length: 42,
      page_url: "https://chat.openai.com/c/session-1",
      domain: "chat.openai.com",
      allowed_site: true
    }),
    buildEvent(session.id, "browser", "browser.ai.response", 4, "2026-04-12T09:40:08.000Z", "provider:openai", {
      provider: "openai",
      response_id: "response-1",
      response_text: "Group add, list, and complete into separate subcommands.",
      response_length: 57,
      page_url: "https://chat.openai.com/c/session-1",
      domain: "chat.openai.com",
      allowed_site: true
    })
  ]);

  const scored = await submitAndScore(controlPlaneApp, session.id);
  assert.equal(scored.session.status, "scored");
  assert.equal(scored.scoring.integrity.verdict, "clean");

  const detailResponse = await controlPlaneApp.inject({
    method: "GET",
    url: `/api/sessions/${session.id}`
  });
  assert.equal(detailResponse.statusCode, 200);
  const detail = detailResponse.json() as { present_streams: string[]; missing_streams: string[] };
  assert.ok(detail.present_streams.includes("browser"));
  assert.deepEqual(detail.missing_streams, []);
});
