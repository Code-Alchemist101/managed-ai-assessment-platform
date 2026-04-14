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

test("demo replay creates a scored session with persisted scoring and ingested events", async (t) => {
  const repoRoot = path.resolve(process.cwd());
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "assessment-platform-demo-"));
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
    ingestionSessionsDir: path.join(dataRoot, "ingestion", "sessions"),
    fixturePath: path.join(repoRoot, "fixtures", "sample-session.json")
  };

  const controlPlaneApp = await buildControlPlaneApp(runtime);
  t.after(async () => {
    await controlPlaneApp.close();
  });

  const replayResponse = await controlPlaneApp.inject({
    method: "POST",
    url: "/api/demo/replay-fixture",
    payload: {}
  });

  assert.equal(replayResponse.statusCode, 200);
  const replayPayload = replayResponse.json();
  assert.equal(replayPayload.session.status, "scored");
  assert.equal(replayPayload.session.has_scoring, true);
  assert.equal(replayPayload.scoring.session_id, replayPayload.session.id);

  const manifestsResponse = await controlPlaneApp.inject({
    method: "GET",
    url: "/api/manifests"
  });
  assert.equal(manifestsResponse.statusCode, 200);
  const manifests = manifestsResponse.json() as Array<{ id: string }>;
  assert.ok(manifests.some((manifest) => manifest.id === "manifest-python-cli"));
  assert.ok(manifests.some((manifest) => manifest.id === "manifest-python-cli-live-desktop-ide"));
  assert.ok(manifests.some((manifest) => manifest.id === "manifest-python-cli-live-full"));

  const sessionsResponse = await controlPlaneApp.inject({
    method: "GET",
    url: "/api/sessions"
  });
  assert.equal(sessionsResponse.statusCode, 200);
  const sessions = sessionsResponse.json() as Array<{ id: string; has_scoring: boolean }>;
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].id, replayPayload.session.id);
  assert.equal(sessions[0].has_scoring, true);

  const scoringResponse = await controlPlaneApp.inject({
    method: "GET",
    url: `/api/sessions/${replayPayload.session.id}/scoring`
  });
  assert.equal(scoringResponse.statusCode, 200);
  const scoring = scoringResponse.json() as { haci_score: number; feature_vector: { signals: unknown[] } };
  assert.equal(scoring.feature_vector.signals.length, 51);
  assert.ok(scoring.haci_score >= 0);

  const eventsResponse = await controlPlaneApp.inject({
    method: "GET",
    url: `/api/sessions/${replayPayload.session.id}/events`
  });
  assert.equal(eventsResponse.statusCode, 200);
  const events = eventsResponse.json() as { events: Array<{ session_id: string }> };
  assert.ok(events.events.length > 0);
  assert.ok(events.events.every((event) => event.session_id === replayPayload.session.id));
});
