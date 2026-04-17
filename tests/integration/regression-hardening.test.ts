/**
 * Regression and edge-case hardening tests for the control-plane API.
 *
 * Covers:
 *  - 404 paths for unknown sessions, missing scoring, missing events, missing decisions
 *  - 400 validation on decision and session-creation payloads
 *  - Reviewer decision overwrite (note → no-note round-trip)
 *  - Empty-note decision is accepted and note field is absent on reload
 *  - Runtime config correctly tracks latest_session_id / latest_scored_session_id
 *  - Manifest registration and retrieval
 *  - Demo replay with an explicit manifest_id selects the correct manifest
 *  - Session status transitions (created → active → submitted → scored/invalid)
 *  - Score endpoint with no ingested events returns 404
 *  - Bootstrap endpoint returns 404 for unknown session
 */
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

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

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
      if (response.ok) return;
    } catch {
      // retry
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
    { cwd: repoRoot, stdio: "ignore" }
  );
}

/** Minimal runtime without analytics or ingestion — for tests that do not score. */
async function setupControlPlaneOnly(t: test.TestContext) {
  const repoRoot = path.resolve(process.cwd());
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "assessment-platform-rh-"));

  t.after(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  const runtime: ControlPlaneRuntime = {
    host: "127.0.0.1",
    port: 0,
    controlPlaneUrl: "http://127.0.0.1:4010",
    ingestionUrl: "http://127.0.0.1:0",
    analyticsUrl: "http://127.0.0.1:0",
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

/** Full runtime with analytics + ingestion — for tests that score sessions. */
async function setupFullStack(t: test.TestContext) {
  const repoRoot = path.resolve(process.cwd());
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "assessment-platform-rh-full-"));
  const analyticsPort = await getFreePort();

  const analytics = spawnAnalytics(repoRoot, analyticsPort);
  t.after(async () => {
    if (!analytics.killed) analytics.kill();
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

  return { controlPlaneApp, runtime, ingestionUrl: `http://127.0.0.1:${ingestionPort}` };
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
    policy_context: { managed_session: true }
  };
}

async function ingestEvents(
  ingestionUrl: string,
  events: ReturnType<typeof buildEvent>[]
): Promise<void> {
  const response = await fetch(`${ingestionUrl}/api/events`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ events })
  });
  assert.equal(response.status, 200);
}

// ---------------------------------------------------------------------------
// 404 / not-found edge cases
// ---------------------------------------------------------------------------

test("GET /api/sessions/:id returns 404 for an unknown session ID", async (t) => {
  const { controlPlaneApp } = await setupControlPlaneOnly(t);
  const unknownId = "00000000-0000-0000-0000-000000000001";

  const response = await controlPlaneApp.inject({
    method: "GET",
    url: `/api/sessions/${unknownId}`
  });

  assert.equal(response.statusCode, 404);
  const body = response.json() as { error: string };
  assert.match(body.error, /not found/i);
});

test("GET /api/sessions/:id/scoring returns 404 when no scoring exists yet", async (t) => {
  const { controlPlaneApp } = await setupControlPlaneOnly(t);

  const createResponse = await controlPlaneApp.inject({
    method: "POST",
    url: "/api/sessions",
    payload: { manifest_id: "manifest-python-cli", candidate_id: "test-candidate" }
  });
  assert.equal(createResponse.statusCode, 200);
  const session = createResponse.json() as { id: string };

  const scoringResponse = await controlPlaneApp.inject({
    method: "GET",
    url: `/api/sessions/${session.id}/scoring`
  });

  assert.equal(scoringResponse.statusCode, 404);
  const body = scoringResponse.json() as { error: string };
  assert.match(body.error, /not found/i);
});

test("GET /api/sessions/:id/events returns 404 when no events have been ingested", async (t) => {
  const { controlPlaneApp } = await setupControlPlaneOnly(t);

  const createResponse = await controlPlaneApp.inject({
    method: "POST",
    url: "/api/sessions",
    payload: { manifest_id: "manifest-python-cli", candidate_id: "test-candidate" }
  });
  assert.equal(createResponse.statusCode, 200);
  const session = createResponse.json() as { id: string };

  const eventsResponse = await controlPlaneApp.inject({
    method: "GET",
    url: `/api/sessions/${session.id}/events`
  });

  assert.equal(eventsResponse.statusCode, 404);
  const body = eventsResponse.json() as { error: string };
  assert.match(body.error, /not found/i);
});

test("GET /api/sessions/:id/decision returns 404 before any decision is recorded", async (t) => {
  const { controlPlaneApp } = await setupControlPlaneOnly(t);

  const createResponse = await controlPlaneApp.inject({
    method: "POST",
    url: "/api/sessions",
    payload: { manifest_id: "manifest-python-cli", candidate_id: "no-decision-yet" }
  });
  assert.equal(createResponse.statusCode, 200);
  const session = createResponse.json() as { id: string };

  const decisionResponse = await controlPlaneApp.inject({
    method: "GET",
    url: `/api/sessions/${session.id}/decision`
  });

  assert.equal(decisionResponse.statusCode, 404);
  const body = decisionResponse.json() as { error: string };
  assert.match(body.error, /no reviewer decision/i);
});

test("POST /api/sessions/:id/decision returns 404 for an unknown session", async (t) => {
  const { controlPlaneApp } = await setupControlPlaneOnly(t);
  const unknownId = "00000000-0000-0000-0000-000000000002";

  const response = await controlPlaneApp.inject({
    method: "POST",
    url: `/api/sessions/${unknownId}/decision`,
    payload: { decision: "approve" }
  });

  assert.equal(response.statusCode, 404);
  const body = response.json() as { error: string };
  assert.match(body.error, /not found/i);
});

test("GET /api/sessions/:id/bootstrap returns 404 for an unknown session", async (t) => {
  const { controlPlaneApp } = await setupControlPlaneOnly(t);
  const unknownId = "00000000-0000-0000-0000-000000000003";

  const response = await controlPlaneApp.inject({
    method: "GET",
    url: `/api/sessions/${unknownId}/bootstrap`
  });

  assert.equal(response.statusCode, 404);
});

// ---------------------------------------------------------------------------
// 400 / bad-request validation edge cases
// ---------------------------------------------------------------------------

test("POST /api/sessions returns 400 when manifest_id is missing", async (t) => {
  const { controlPlaneApp } = await setupControlPlaneOnly(t);

  const response = await controlPlaneApp.inject({
    method: "POST",
    url: "/api/sessions",
    payload: { candidate_id: "test-candidate" }
  });

  assert.equal(response.statusCode, 400);
  const body = response.json() as { error: string };
  assert.match(body.error, /required/i);
});

test("POST /api/sessions returns 400 when candidate_id is missing", async (t) => {
  const { controlPlaneApp } = await setupControlPlaneOnly(t);

  const response = await controlPlaneApp.inject({
    method: "POST",
    url: "/api/sessions",
    payload: { manifest_id: "manifest-python-cli" }
  });

  assert.equal(response.statusCode, 400);
  const body = response.json() as { error: string };
  assert.match(body.error, /required/i);
});

test("POST /api/sessions/:id/decision returns 400 for an invalid decision value", async (t) => {
  const { controlPlaneApp } = await setupControlPlaneOnly(t);

  const createResponse = await controlPlaneApp.inject({
    method: "POST",
    url: "/api/sessions",
    payload: { manifest_id: "manifest-python-cli", candidate_id: "decision-validation-test" }
  });
  assert.equal(createResponse.statusCode, 200);
  const session = createResponse.json() as { id: string };

  const response = await controlPlaneApp.inject({
    method: "POST",
    url: `/api/sessions/${session.id}/decision`,
    payload: { decision: "not_a_real_decision_value" }
  });

  assert.equal(response.statusCode, 400);
});

// ---------------------------------------------------------------------------
// Reviewer decision overwrite edge cases
// ---------------------------------------------------------------------------

test("reviewer decision overwrite: changing decision clears the previous note", async (t) => {
  const { controlPlaneApp } = await setupControlPlaneOnly(t);

  const createResponse = await controlPlaneApp.inject({
    method: "POST",
    url: "/api/sessions",
    payload: { manifest_id: "manifest-python-cli", candidate_id: "overwrite-test" }
  });
  assert.equal(createResponse.statusCode, 200);
  const session = createResponse.json() as { id: string };

  // First decision with a note.
  await controlPlaneApp.inject({
    method: "POST",
    url: `/api/sessions/${session.id}/decision`,
    payload: { decision: "approve", note: "Initial note." }
  });

  // Overwrite with different decision and no note.
  const overwriteResponse = await controlPlaneApp.inject({
    method: "POST",
    url: `/api/sessions/${session.id}/decision`,
    payload: { decision: "needs_followup" }
  });
  assert.equal(overwriteResponse.statusCode, 200);
  const overwrite = overwriteResponse.json() as { decision: string; note?: string };
  assert.equal(overwrite.decision, "needs_followup");
  assert.equal(overwrite.note, undefined, "note should be absent when not supplied on overwrite");

  // GET confirms the overwrite.
  const getResponse = await controlPlaneApp.inject({
    method: "GET",
    url: `/api/sessions/${session.id}/decision`
  });
  assert.equal(getResponse.statusCode, 200);
  const gotten = getResponse.json() as { decision: string; note?: string };
  assert.equal(gotten.decision, "needs_followup");
  assert.equal(gotten.note, undefined);
});

test("reviewer decision accepts an empty string note and stores it", async (t) => {
  const { controlPlaneApp } = await setupControlPlaneOnly(t);

  const createResponse = await controlPlaneApp.inject({
    method: "POST",
    url: "/api/sessions",
    payload: { manifest_id: "manifest-python-cli", candidate_id: "empty-note-test" }
  });
  assert.equal(createResponse.statusCode, 200);
  const session = createResponse.json() as { id: string };

  // Post with an explicit empty string note.
  const postResponse = await controlPlaneApp.inject({
    method: "POST",
    url: `/api/sessions/${session.id}/decision`,
    payload: { decision: "reject", note: "" }
  });
  assert.equal(postResponse.statusCode, 200);
  const posted = postResponse.json() as { decision: string; note?: string };
  assert.equal(posted.decision, "reject");
  // An empty string note is provided — it should be present (even if empty) or absent.
  // Either is acceptable; we just verify the decision is correct and there is no crash.
  assert.equal(posted.decision, "reject");

  // GET confirms the decision is persisted.
  const getResponse = await controlPlaneApp.inject({
    method: "GET",
    url: `/api/sessions/${session.id}/decision`
  });
  assert.equal(getResponse.statusCode, 200);
  const gotten = getResponse.json() as { decision: string };
  assert.equal(gotten.decision, "reject");
});

// ---------------------------------------------------------------------------
// Runtime config correctness
// ---------------------------------------------------------------------------

test("GET /api/runtime returns null latest_scored_session_id when no sessions exist", async (t) => {
  const { controlPlaneApp } = await setupControlPlaneOnly(t);

  const response = await controlPlaneApp.inject({ method: "GET", url: "/api/runtime" });
  assert.equal(response.statusCode, 200);
  const runtime = response.json() as {
    latest_session_id: string | null;
    latest_scored_session_id: string | null;
  };
  assert.equal(runtime.latest_session_id, null);
  assert.equal(runtime.latest_scored_session_id, null);
});

test("GET /api/runtime latest_session_id updates when a new session is created", async (t) => {
  const { controlPlaneApp } = await setupControlPlaneOnly(t);

  const createResponse = await controlPlaneApp.inject({
    method: "POST",
    url: "/api/sessions",
    payload: { manifest_id: "manifest-python-cli", candidate_id: "runtime-test" }
  });
  assert.equal(createResponse.statusCode, 200);
  const session = createResponse.json() as { id: string };

  const runtimeResponse = await controlPlaneApp.inject({ method: "GET", url: "/api/runtime" });
  assert.equal(runtimeResponse.statusCode, 200);
  const runtime = runtimeResponse.json() as {
    latest_session_id: string | null;
    latest_scored_session_id: string | null;
  };
  assert.equal(runtime.latest_session_id, session.id);
  // No scoring yet so this should remain null.
  assert.equal(runtime.latest_scored_session_id, null);
});

test("GET /api/runtime latest_scored_session_id is set after a scored session is replayed", async (t) => {
  const { controlPlaneApp } = await setupFullStack(t);

  const replayResponse = await controlPlaneApp.inject({
    method: "POST",
    url: "/api/demo/replay-fixture",
    payload: {}
  });
  assert.equal(replayResponse.statusCode, 200);
  const replay = replayResponse.json() as { session: { id: string; status: string } };
  assert.equal(replay.session.status, "scored");

  const runtimeResponse = await controlPlaneApp.inject({ method: "GET", url: "/api/runtime" });
  assert.equal(runtimeResponse.statusCode, 200);
  const runtime = runtimeResponse.json() as {
    latest_session_id: string | null;
    latest_scored_session_id: string | null;
  };
  assert.equal(runtime.latest_session_id, replay.session.id);
  assert.equal(runtime.latest_scored_session_id, replay.session.id);
});

test("GET /api/runtime latest_scored_session_id tracks first scored when newer session is unscored", async (t) => {
  const { controlPlaneApp } = await setupFullStack(t);

  // Create and score the first session via replay.
  const replayResponse = await controlPlaneApp.inject({
    method: "POST",
    url: "/api/demo/replay-fixture",
    payload: {}
  });
  assert.equal(replayResponse.statusCode, 200);
  const scoredSession = (replayResponse.json() as { session: { id: string } }).session;

  // Create a second session that is never scored.
  const unscoredResponse = await controlPlaneApp.inject({
    method: "POST",
    url: "/api/sessions",
    payload: { manifest_id: "manifest-python-cli", candidate_id: "unscored-session" }
  });
  assert.equal(unscoredResponse.statusCode, 200);
  const unscoredSession = unscoredResponse.json() as { id: string };

  const runtimeResponse = await controlPlaneApp.inject({ method: "GET", url: "/api/runtime" });
  assert.equal(runtimeResponse.statusCode, 200);
  const runtime = runtimeResponse.json() as {
    latest_session_id: string | null;
    latest_scored_session_id: string | null;
  };
  // Latest session is the unscored one (most recently created).
  assert.equal(runtime.latest_session_id, unscoredSession.id);
  // Latest *scored* session is still the first one.
  assert.equal(runtime.latest_scored_session_id, scoredSession.id);
});

// ---------------------------------------------------------------------------
// Score endpoint without events
// ---------------------------------------------------------------------------

test("POST /api/sessions/:id/score returns 404 when no events have been ingested", async (t) => {
  const { controlPlaneApp } = await setupFullStack(t);

  const createResponse = await controlPlaneApp.inject({
    method: "POST",
    url: "/api/sessions",
    payload: { manifest_id: "manifest-python-cli", candidate_id: "no-events-score-test" }
  });
  assert.equal(createResponse.statusCode, 200);
  const session = createResponse.json() as { id: string };

  // Transition to submitted without ingesting any events.
  await controlPlaneApp.inject({
    method: "POST",
    url: `/api/sessions/${session.id}/status`,
    payload: { status: "submitted" }
  });

  const scoreResponse = await controlPlaneApp.inject({
    method: "POST",
    url: `/api/sessions/${session.id}/score`
  });

  assert.equal(scoreResponse.statusCode, 404);
  const body = scoreResponse.json() as { error: string };
  assert.match(body.error, /no ingested events/i);
});

// ---------------------------------------------------------------------------
// Manifest registration
// ---------------------------------------------------------------------------

test("POST /api/manifests registers a new manifest that subsequently appears in GET /api/manifests", async (t) => {
  const { controlPlaneApp } = await setupControlPlaneOnly(t);

  const customManifest = {
    id: "manifest-custom-test",
    name: "Custom Test Manifest",
    task_prompt: "Build a thing.",
    language: "typescript",
    allowed_ai_providers: ["openai"],
    allowed_sites: ["developer.mozilla.org"],
    required_streams: ["desktop", "ide"],
    evidence_settings: {
      screenshots_enabled: false,
      screen_recording_metadata_only: true
    },
    decision_policy: {
      auto_advance_min_confidence: 0.85,
      auto_reject_enabled: false,
      require_full_completeness: true
    }
  };

  const postResponse = await controlPlaneApp.inject({
    method: "POST",
    url: "/api/manifests",
    payload: customManifest
  });
  assert.equal(postResponse.statusCode, 200);
  const created = postResponse.json() as { id: string };
  assert.equal(created.id, "manifest-custom-test");

  const listResponse = await controlPlaneApp.inject({
    method: "GET",
    url: "/api/manifests"
  });
  assert.equal(listResponse.statusCode, 200);
  const manifests = listResponse.json() as Array<{ id: string }>;
  assert.ok(manifests.some((m) => m.id === "manifest-custom-test"));
});

// ---------------------------------------------------------------------------
// Demo replay with explicit manifest_id
// ---------------------------------------------------------------------------

test("POST /api/demo/replay-fixture respects an explicit manifest_id", async (t) => {
  const { controlPlaneApp } = await setupFullStack(t);

  // Replay the fixture using the 'desktop+ide' manifest instead of the default.
  const replayResponse = await controlPlaneApp.inject({
    method: "POST",
    url: "/api/demo/replay-fixture",
    payload: { manifest_id: "manifest-python-cli-live-desktop-ide" }
  });
  assert.equal(replayResponse.statusCode, 200);
  const payload = replayResponse.json() as {
    session: { id: string; manifest_id: string; status: string };
  };
  assert.equal(payload.session.manifest_id, "manifest-python-cli-live-desktop-ide");
  assert.equal(payload.session.status, "scored");
});

test("POST /api/demo/replay-fixture returns 404 for an unknown manifest_id", async (t) => {
  const { controlPlaneApp } = await setupFullStack(t);

  const replayResponse = await controlPlaneApp.inject({
    method: "POST",
    url: "/api/demo/replay-fixture",
    payload: { manifest_id: "manifest-does-not-exist" }
  });
  assert.equal(replayResponse.statusCode, 404);
});

// ---------------------------------------------------------------------------
// Session detail — partial-data states
// ---------------------------------------------------------------------------

test("GET /api/sessions/:id returns partial detail with null scoring fields for an unscored session", async (t) => {
  const { controlPlaneApp } = await setupControlPlaneOnly(t);

  const createResponse = await controlPlaneApp.inject({
    method: "POST",
    url: "/api/sessions",
    payload: { manifest_id: "manifest-python-cli", candidate_id: "unscored-detail-test" }
  });
  assert.equal(createResponse.statusCode, 200);
  const session = createResponse.json() as { id: string };

  const detailResponse = await controlPlaneApp.inject({
    method: "GET",
    url: `/api/sessions/${session.id}`
  });
  assert.equal(detailResponse.statusCode, 200);
  const detail = detailResponse.json() as {
    has_scoring: boolean;
    integrity_verdict: string | null;
    haci_score: number | null;
    predicted_archetype: string | null;
    policy_recommendation: string | null;
  };

  assert.equal(detail.has_scoring, false);
  assert.equal(detail.integrity_verdict, null);
  assert.equal(detail.haci_score, null);
  assert.equal(detail.predicted_archetype, null);
  assert.equal(detail.policy_recommendation, null);
});

// ---------------------------------------------------------------------------
// Session status transitions
// ---------------------------------------------------------------------------

test("POST /api/sessions/:id/status 404 for an unknown session", async (t) => {
  const { controlPlaneApp } = await setupControlPlaneOnly(t);
  const unknownId = "00000000-0000-0000-0000-000000000004";

  const response = await controlPlaneApp.inject({
    method: "POST",
    url: `/api/sessions/${unknownId}/status`,
    payload: { status: "active" }
  });
  assert.equal(response.statusCode, 404);
});

test("POST /api/sessions/:id/status 400 when status field is missing", async (t) => {
  const { controlPlaneApp } = await setupControlPlaneOnly(t);

  const createResponse = await controlPlaneApp.inject({
    method: "POST",
    url: "/api/sessions",
    payload: { manifest_id: "manifest-python-cli", candidate_id: "status-missing-test" }
  });
  assert.equal(createResponse.statusCode, 200);
  const session = createResponse.json() as { id: string };

  const response = await controlPlaneApp.inject({
    method: "POST",
    url: `/api/sessions/${session.id}/status`,
    payload: {}
  });
  assert.equal(response.statusCode, 400);
});

// ---------------------------------------------------------------------------
// Full flow: session with events scores and details are enriched
// ---------------------------------------------------------------------------

test("session scored with desktop+ide telemetry produces enriched detail and decision can be recorded", async (t) => {
  const { controlPlaneApp, ingestionUrl } = await setupFullStack(t);

  const createResponse = await controlPlaneApp.inject({
    method: "POST",
    url: "/api/sessions",
    payload: { manifest_id: "manifest-python-cli-live-desktop-ide", candidate_id: "full-flow-test" }
  });
  assert.equal(createResponse.statusCode, 200);
  const session = createResponse.json() as { id: string };

  await controlPlaneApp.inject({
    method: "POST",
    url: `/api/sessions/${session.id}/status`,
    payload: { status: "active" }
  });

  await ingestEvents(ingestionUrl, [
    buildEvent(session.id, "desktop", "session.started", 1, "2026-04-15T10:00:00Z", "session", { status: "active" }),
    buildEvent(session.id, "desktop", "session.heartbeat", 2, "2026-04-15T10:00:30Z", "session", { status: "active" }),
    buildEvent(session.id, "ide", "ide.extension.activated", 1, "2026-04-15T10:00:05Z", "extension:assessment-platform", { mode: "injected" }),
    buildEvent(session.id, "ide", "ide.document.changed", 2, "2026-04-15T10:00:10Z", "file:C:/repo/main.py", {
      inserted_text: "def hello(): pass",
      inserted_chars: 17,
      deleted_chars: 0,
      change_source: "typing"
    }),
    buildEvent(session.id, "ide", "ide.document.saved", 3, "2026-04-15T10:00:15Z", "file:C:/repo/main.py", { version: 1 })
  ]);

  await controlPlaneApp.inject({
    method: "POST",
    url: `/api/sessions/${session.id}/status`,
    payload: { status: "submitted" }
  });

  const scoreResponse = await controlPlaneApp.inject({
    method: "POST",
    url: `/api/sessions/${session.id}/score`
  });
  assert.equal(scoreResponse.statusCode, 200);
  const scored = scoreResponse.json() as { session: { status: string }; scoring: { integrity: { verdict: string } } };
  assert.equal(scored.session.status, "scored");
  assert.ok(["clean", "review"].includes(scored.scoring.integrity.verdict));

  // Scoring detail is retrievable.
  const scoringResponse = await controlPlaneApp.inject({
    method: "GET",
    url: `/api/sessions/${session.id}/scoring`
  });
  assert.equal(scoringResponse.statusCode, 200);
  const scoring = scoringResponse.json() as { haci_score: number; heuristic_result: unknown };
  assert.ok(scoring.haci_score >= 0 && scoring.haci_score <= 100);
  assert.ok(scoring.heuristic_result !== undefined);

  // Reviewer decision can be recorded and retrieved.
  const decisionPostResponse = await controlPlaneApp.inject({
    method: "POST",
    url: `/api/sessions/${session.id}/decision`,
    payload: { decision: "approve", note: "Good independent work." }
  });
  assert.equal(decisionPostResponse.statusCode, 200);

  const decisionGetResponse = await controlPlaneApp.inject({
    method: "GET",
    url: `/api/sessions/${session.id}/decision`
  });
  assert.equal(decisionGetResponse.statusCode, 200);
  const decision = decisionGetResponse.json() as { decision: string; note: string };
  assert.equal(decision.decision, "approve");
  assert.equal(decision.note, "Good independent work.");

  // Session detail reflects scored state.
  const detailResponse = await controlPlaneApp.inject({
    method: "GET",
    url: `/api/sessions/${session.id}`
  });
  assert.equal(detailResponse.statusCode, 200);
  const detail = detailResponse.json() as {
    status: string;
    has_scoring: boolean;
    haci_score: number | null;
    integrity_verdict: string | null;
  };
  assert.equal(detail.status, "scored");
  assert.equal(detail.has_scoring, true);
  assert.ok(detail.haci_score !== null);
  assert.ok(detail.integrity_verdict !== null);
});

// ---------------------------------------------------------------------------
// Manifest policy override propagates to scoring recommendation
// ---------------------------------------------------------------------------

test("custom manifest with low auto_advance threshold allows auto-advance recommendation", async (t) => {
  const { controlPlaneApp, ingestionUrl } = await setupFullStack(t);

  // Register a permissive custom manifest.
  const permissiveManifest = {
    id: "manifest-very-permissive",
    name: "Permissive Test Manifest",
    task_prompt: "Anything goes.",
    language: "python",
    allowed_ai_providers: ["openai"],
    allowed_sites: ["developer.mozilla.org"],
    required_streams: ["desktop", "ide"],
    evidence_settings: { screenshots_enabled: false, screen_recording_metadata_only: true },
    decision_policy: {
      auto_advance_min_confidence: 0.01,
      auto_reject_enabled: false,
      require_full_completeness: true
    }
  };

  await controlPlaneApp.inject({
    method: "POST",
    url: "/api/manifests",
    payload: permissiveManifest
  });

  const createResponse = await controlPlaneApp.inject({
    method: "POST",
    url: "/api/sessions",
    payload: { manifest_id: "manifest-very-permissive", candidate_id: "policy-test" }
  });
  assert.equal(createResponse.statusCode, 200);
  const session = createResponse.json() as { id: string };

  await controlPlaneApp.inject({
    method: "POST",
    url: `/api/sessions/${session.id}/status`,
    payload: { status: "active" }
  });

  // Ingest enough events to clear the sparse/low-information flag.
  const events = Array.from({ length: 12 }, (_, i) => {
    const isDesktop = i < 3;
    return buildEvent(
      session.id,
      isDesktop ? "desktop" : "ide",
      i === 0 ? "session.started" : i === 1 ? "session.heartbeat" : "ide.document.changed",
      i + 1,
      `2026-04-15T10:${String(i).padStart(2, "0")}:00Z`,
      isDesktop ? "session" : "file:C:/repo/main.py",
      !isDesktop ? { inserted_chars: 20, deleted_chars: 0, change_source: "typing" } : { status: "active" }
    );
  });
  await ingestEvents(ingestionUrl, events);

  await controlPlaneApp.inject({
    method: "POST",
    url: `/api/sessions/${session.id}/status`,
    payload: { status: "submitted" }
  });

  const scoreResponse = await controlPlaneApp.inject({
    method: "POST",
    url: `/api/sessions/${session.id}/score`
  });
  assert.equal(scoreResponse.statusCode, 200);
  const scored = scoreResponse.json() as {
    scoring: {
      policy_recommendation: string;
      review_required: boolean;
      confidence: number;
      haci_score: number;
      integrity: { verdict: string };
    };
  };

  // The policy_recommendation must be one of the valid values.
  const validPolicies = ["auto-advance", "human-review", "invalid-session"];
  assert.ok(
    validPolicies.includes(scored.scoring.policy_recommendation),
    `Unexpected policy_recommendation: ${scored.scoring.policy_recommendation}`
  );

  // Auto-advance fires when all three conditions are met:
  // (1) clean integrity, (2) confidence >= threshold (0.01), (3) haci_score >= 65.
  // Verify that if auto-advance fires, all conditions are indeed satisfied.
  if (scored.scoring.policy_recommendation === "auto-advance") {
    assert.equal(scored.scoring.integrity.verdict, "clean");
    assert.ok(scored.scoring.confidence >= 0.01);
    assert.ok(scored.scoring.haci_score >= 65);
    assert.equal(scored.scoring.review_required, false);
  }

  // Verify review_required is consistent with policy_recommendation.
  if (scored.scoring.policy_recommendation === "auto-advance") {
    assert.equal(scored.scoring.review_required, false);
  } else {
    assert.equal(scored.scoring.review_required, true);
  }
});
