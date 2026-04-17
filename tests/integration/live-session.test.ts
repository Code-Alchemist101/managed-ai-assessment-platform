import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import http from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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

async function setupControlPlaneWithCustomAnalytics(
  t: test.TestContext,
  analyticsUrl: string,
  options?: { retryDelay?: (ms: number) => Promise<void> }
): Promise<{ controlPlaneApp: Awaited<ReturnType<typeof buildControlPlaneApp>>; runtime: ControlPlaneRuntime }> {
  const repoRoot = path.resolve(process.cwd());
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "assessment-platform-failure-"));
  t.after(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

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
    analyticsUrl,
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

  const controlPlaneApp = await buildControlPlaneApp(runtime, options);
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

test("scoreSession marks session as failed and records scoring_error when analytics always returns 5xx", async (t) => {
  let analyticsRequestCount = 0;

  const mockAnalyticsServer = http.createServer((_req, res) => {
    analyticsRequestCount++;
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Internal Server Error" }));
  });
  await new Promise<void>((resolve) => mockAnalyticsServer.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve, reject) => mockAnalyticsServer.close((err) => (err ? reject(err) : resolve()))));

  const mockPort = (mockAnalyticsServer.address() as AddressInfo).port;
  const { controlPlaneApp, runtime } = await setupControlPlaneWithCustomAnalytics(
    t,
    `http://127.0.0.1:${mockPort}`,
    { retryDelay: () => Promise.resolve() }
  );

  const session = await createSession(controlPlaneApp, "manifest-python-cli-live-desktop-ide", "candidate-retry");

  await ingestEvents(runtime.ingestionUrl, [
    buildEvent(session.id, "desktop", "session.started", 1, "2026-04-12T09:29:37.000Z", "session", { status: "active" }),
    buildEvent(session.id, "ide", "ide.extension.activated", 1, "2026-04-12T09:29:40.000Z", "extension:assessment-platform", {
      mode: "injected"
    })
  ]);

  await controlPlaneApp.inject({ method: "POST", url: `/api/sessions/${session.id}/status`, payload: { status: "submitted" } });

  const scoreResponse = await controlPlaneApp.inject({
    method: "POST",
    url: `/api/sessions/${session.id}/score`
  });

  assert.equal(scoreResponse.statusCode, 502, "Expected 502 after analytics 5xx");
  assert.equal(
    analyticsRequestCount,
    3,
    `Expected exactly 3 analytics requests (one per retry attempt), got ${analyticsRequestCount}`
  );

  const detailResponse = await controlPlaneApp.inject({ method: "GET", url: `/api/sessions/${session.id}` });
  assert.equal(detailResponse.statusCode, 200);
  const detail = detailResponse.json() as { status: string; scoring_error?: string | null };
  assert.equal(detail.status, "failed", "Session should be in failed state after exhausted retries");
  assert.ok(detail.scoring_error, "Session detail should include a scoring_error message");
  assert.match(detail.scoring_error as string, /500/, "scoring_error should reference the HTTP 500 status");
});

test("scoreSession marks session as failed when analytics is unreachable", async (t) => {
  const closedPort = await getFreePort();

  const { controlPlaneApp, runtime } = await setupControlPlaneWithCustomAnalytics(
    t,
    `http://127.0.0.1:${closedPort}`,
    { retryDelay: () => Promise.resolve() }
  );

  const session = await createSession(controlPlaneApp, "manifest-python-cli-live-desktop-ide", "candidate-unreachable");

  await ingestEvents(runtime.ingestionUrl, [
    buildEvent(session.id, "desktop", "session.started", 1, "2026-04-12T09:29:37.000Z", "session", { status: "active" }),
    buildEvent(session.id, "ide", "ide.extension.activated", 1, "2026-04-12T09:29:40.000Z", "extension:assessment-platform", {
      mode: "injected"
    })
  ]);

  await controlPlaneApp.inject({ method: "POST", url: `/api/sessions/${session.id}/status`, payload: { status: "submitted" } });

  const scoreResponse = await controlPlaneApp.inject({
    method: "POST",
    url: `/api/sessions/${session.id}/score`
  });

  assert.equal(scoreResponse.statusCode, 502, "Expected 502 when analytics is unreachable");

  const detailResponse = await controlPlaneApp.inject({ method: "GET", url: `/api/sessions/${session.id}` });
  assert.equal(detailResponse.statusCode, 200);
  const detail = detailResponse.json() as { status: string; scoring_error?: string | null };
  assert.equal(detail.status, "failed", "Session should be in failed state when analytics is unreachable");
  assert.ok(detail.scoring_error, "Session detail should include a scoring_error message when unreachable");
});

test("scoreSession succeeds and clears scoring_error when analytics recovers after initial failure", async (t) => {
  let requestCount = 0;

  const mockAnalyticsServer = http.createServer((req, res) => {
    requestCount++;
    if (requestCount < 3) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Temporary failure" }));
      return;
    }
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      const parsed = JSON.parse(body) as { session_context: { session_id: string } };
      const sessionId = parsed.session_context.session_id;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          session_id: sessionId,
          model_version: "heuristic-v1",
          scoring_mode: "heuristic",
          haci_score: 72,
          haci_band: "medium",
          predicted_archetype: "Independent Solver",
          archetype_probabilities: { "Independent Solver": 0.8, "Blind Copier": 0.2 },
          confidence: 0.8,
          top_features: [],
          integrity: {
            verdict: "clean",
            flags: [],
            required_streams_present: ["desktop", "ide"],
            missing_streams: [],
            notes: []
          },
          policy_recommendation: "human-review",
          review_required: true,
          trained_model_result: null,
          feature_vector: {
            session_id: sessionId,
            extraction_version: "1.0",
            generated_at: new Date().toISOString(),
            signal_values: {},
            signals: [],
            completeness: "partial",
            invalidation_reasons: []
          }
        })
      );
    });
  });
  await new Promise<void>((resolve) => mockAnalyticsServer.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve, reject) => mockAnalyticsServer.close((err) => (err ? reject(err) : resolve()))));

  const mockPort = (mockAnalyticsServer.address() as AddressInfo).port;
  const { controlPlaneApp, runtime } = await setupControlPlaneWithCustomAnalytics(
    t,
    `http://127.0.0.1:${mockPort}`,
    { retryDelay: () => Promise.resolve() }
  );

  const session = await createSession(controlPlaneApp, "manifest-python-cli-live-desktop-ide", "candidate-recover");

  await ingestEvents(runtime.ingestionUrl, [
    buildEvent(session.id, "desktop", "session.started", 1, "2026-04-12T09:29:37.000Z", "session", { status: "active" }),
    buildEvent(session.id, "ide", "ide.extension.activated", 1, "2026-04-12T09:29:40.000Z", "extension:assessment-platform", {
      mode: "injected"
    })
  ]);

  await controlPlaneApp.inject({ method: "POST", url: `/api/sessions/${session.id}/status`, payload: { status: "submitted" } });

  const scoreResponse = await controlPlaneApp.inject({
    method: "POST",
    url: `/api/sessions/${session.id}/score`
  });

  assert.equal(scoreResponse.statusCode, 200, "Expected 200 after analytics recovered on third attempt");
  const scored = scoreResponse.json() as { session: { status: string; scoring_error?: string | null } };
  assert.equal(scored.session.status, "scored", "Session should be scored after recovery");
  assert.equal(scored.session.scoring_error, null, "scoring_error should be null after successful scoring");
});

test("corrupted scoring file yields scoring_status=corrupted and has_scoring=true in session detail", async (t) => {
  const { controlPlaneApp, runtime } = await setupControlPlaneWithCustomAnalytics(
    t,
    "http://127.0.0.1:1" // unused — no scoring call is made in this test
  );

  const session = await createSession(controlPlaneApp, "manifest-python-cli-live-desktop-ide", "candidate-corrupted");

  // Write a corrupted (invalid JSON) scoring file for the session
  const corruptedFilePath = path.join(runtime.scoringsDir, `${session.id}.json`);
  await writeFile(corruptedFilePath, "{ this is not valid json !!!!", "utf8");

  const detailResponse = await controlPlaneApp.inject({ method: "GET", url: `/api/sessions/${session.id}` });
  assert.equal(detailResponse.statusCode, 200);
  const detail = detailResponse.json() as {
    has_scoring: boolean;
    scoring_status?: string;
    scoring_error?: string | null;
  };

  assert.equal(detail.has_scoring, true, "has_scoring should be true when scoring file exists but is corrupted");
  assert.equal(detail.scoring_status, "corrupted", "scoring_status should be 'corrupted' for an unreadable scoring file");
  assert.ok(detail.scoring_error, "scoring_error should be populated with a parse error message");
});

test("valid scoring file yields scoring_status=ok in session detail", async (t) => {
  const { controlPlaneApp, runtime } = await setupControlPlaneWithCustomAnalytics(
    t,
    "http://127.0.0.1:1" // unused — scoring is written manually below
  );

  const session = await createSession(controlPlaneApp, "manifest-python-cli-live-desktop-ide", "candidate-valid-scoring");

  // Write a valid scoring file directly
  const validScoring = {
    session_id: session.id,
    model_version: "heuristic-v1",
    scoring_mode: "heuristic",
    haci_score: 65,
    haci_band: "medium",
    predicted_archetype: "Independent Solver",
    archetype_probabilities: { "Independent Solver": 0.75, "Blind Copier": 0.25 },
    confidence: 0.75,
    top_features: [],
    integrity: {
      verdict: "clean",
      flags: [],
      required_streams_present: ["desktop", "ide"],
      missing_streams: [],
      notes: []
    },
    policy_recommendation: "human-review",
    review_required: true,
    trained_model_result: null,
    feature_vector: {
      session_id: session.id,
      extraction_version: "1.0",
      generated_at: new Date().toISOString(),
      signal_values: {},
      signals: [],
      completeness: "partial",
      invalidation_reasons: []
    }
  };
  const validFilePath = path.join(runtime.scoringsDir, `${session.id}.json`);
  await writeFile(validFilePath, JSON.stringify(validScoring), "utf8");

  const detailResponse = await controlPlaneApp.inject({ method: "GET", url: `/api/sessions/${session.id}` });
  assert.equal(detailResponse.statusCode, 200);
  const detail = detailResponse.json() as {
    scoring_status?: string;
    scoring_error?: string | null;
    haci_score?: number | null;
    predicted_archetype?: string | null;
  };

  assert.equal(detail.scoring_status, "ok", "scoring_status should be 'ok' for a valid scoring file");
  assert.equal(detail.haci_score, 65, "haci_score should be populated from valid scoring file");
  assert.equal(detail.predicted_archetype, "Independent Solver");
});

test("session with no scoring file returns scoring_status=pending", async (t) => {
  const { controlPlaneApp } = await setupControlPlaneWithCustomAnalytics(
    t,
    "http://127.0.0.1:1" // unused — no scoring call is made in this test
  );

  const session = await createSession(controlPlaneApp, "manifest-python-cli-live-desktop-ide", "candidate-pending");

  const detailResponse = await controlPlaneApp.inject({ method: "GET", url: `/api/sessions/${session.id}` });
  assert.equal(detailResponse.statusCode, 200);
  const detail = detailResponse.json() as { scoring_status?: string; has_scoring: boolean };

  assert.equal(detail.scoring_status, "pending");
  assert.equal(detail.has_scoring, false);
});
