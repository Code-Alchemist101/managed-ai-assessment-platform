/**
 * Audit edge-case integration tests — added during end-to-end stability audit.
 *
 * Covers:
 *  - Control-plane API 404/400 error responses for unknown sessions and bad bodies
 *  - GET /api/sessions/:id/scoring before scoring → 404
 *  - GET /api/sessions/:id/decision with no decision yet → 404
 *  - POST /api/sessions/:id/decision with invalid body → 400
 *  - Decision with empty string note
 *  - Decision overwrite (approve→reject, note→no-note)
 *  - /api/runtime returns correct latest_session_id and latest_scored_session_id
 *  - POST /api/sessions missing required fields → 400
 *  - Session detail before events are ingested (no-events state)
 *  - POST /api/sessions/:id/status with invalid status → error
 *  - Session list ordering (newest first)
 */

import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { buildControlPlaneApp } from "../../services/control-plane-api/src/app";
import type { ControlPlaneRuntime } from "../../services/control-plane-api/src/runtime";

async function buildTestRuntime(dataRoot: string, repoRoot: string): Promise<ControlPlaneRuntime> {
  return {
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
}

async function setupApp(t: test.TestContext) {
  const repoRoot = path.resolve(process.cwd());
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "assessment-audit-"));
  const runtime = await buildTestRuntime(dataRoot, repoRoot);
  const app = await buildControlPlaneApp(runtime);
  t.after(async () => {
    await app.close();
    await rm(dataRoot, { recursive: true, force: true });
  });
  return { app, runtime };
}

// ---------------------------------------------------------------------------
// POST /api/sessions – missing required fields
// ---------------------------------------------------------------------------

test("POST /api/sessions returns 400 when manifest_id is missing", async (t) => {
  const { app } = await setupApp(t);

  const response = await app.inject({
    method: "POST",
    url: "/api/sessions",
    payload: { candidate_id: "test-candidate" }
  });

  assert.equal(response.statusCode, 400);
  const body = response.json() as { error: string };
  assert.ok(body.error, "response must include an error message");
});

test("POST /api/sessions returns 400 when candidate_id is missing", async (t) => {
  const { app } = await setupApp(t);

  const response = await app.inject({
    method: "POST",
    url: "/api/sessions",
    payload: { manifest_id: "manifest-python-cli" }
  });

  assert.equal(response.statusCode, 400);
  const body = response.json() as { error: string };
  assert.ok(body.error, "response must include an error message");
});

test("POST /api/sessions returns 400 when body is empty", async (t) => {
  const { app } = await setupApp(t);

  const response = await app.inject({
    method: "POST",
    url: "/api/sessions",
    payload: {}
  });

  assert.equal(response.statusCode, 400);
});

// ---------------------------------------------------------------------------
// GET /api/sessions/:id – unknown session
// ---------------------------------------------------------------------------

test("GET /api/sessions/:id returns 404 for unknown session", async (t) => {
  const { app } = await setupApp(t);

  const response = await app.inject({
    method: "GET",
    url: "/api/sessions/nonexistent-session-id"
  });

  assert.equal(response.statusCode, 404);
  const body = response.json() as { error: string };
  assert.ok(body.error);
});

// ---------------------------------------------------------------------------
// GET /api/sessions/:id/scoring – before scoring is available
// ---------------------------------------------------------------------------

test("GET /api/sessions/:id/scoring returns 404 for an unscored session", async (t) => {
  const { app } = await setupApp(t);

  const createResponse = await app.inject({
    method: "POST",
    url: "/api/sessions",
    payload: { manifest_id: "manifest-python-cli", candidate_id: "audit-test" }
  });
  assert.equal(createResponse.statusCode, 200);
  const session = createResponse.json() as { id: string };

  const scoringResponse = await app.inject({
    method: "GET",
    url: `/api/sessions/${session.id}/scoring`
  });

  assert.equal(scoringResponse.statusCode, 404, "scoring endpoint must return 404 before scoring");
  const body = scoringResponse.json() as { error: string };
  assert.ok(body.error);
});

// ---------------------------------------------------------------------------
// GET /api/sessions/:id – session detail with no ingested events
// ---------------------------------------------------------------------------

test("GET /api/sessions/:id returns detail with empty streams when no events ingested", async (t) => {
  const { app } = await setupApp(t);

  const createResponse = await app.inject({
    method: "POST",
    url: "/api/sessions",
    payload: { manifest_id: "manifest-python-cli", candidate_id: "audit-no-events" }
  });
  assert.equal(createResponse.statusCode, 200);
  const session = createResponse.json() as { id: string };

  const detailResponse = await app.inject({
    method: "GET",
    url: `/api/sessions/${session.id}`
  });
  assert.equal(detailResponse.statusCode, 200);

  const detail = detailResponse.json() as {
    id: string;
    has_scoring: boolean;
    integrity_verdict: string | null;
    present_streams: string[];
    haci_score: number | null;
    predicted_archetype: string | null;
  };

  assert.equal(detail.id, session.id);
  assert.equal(detail.has_scoring, false);
  assert.equal(detail.integrity_verdict, null, "no scoring → integrity_verdict must be null");
  assert.deepEqual(detail.present_streams, [], "no events → no present streams");
  assert.equal(detail.haci_score, null, "no scoring → haci_score must be null");
  assert.equal(detail.predicted_archetype, null, "no scoring → predicted_archetype must be null");
});

// ---------------------------------------------------------------------------
// Reviewer decision – unknown session returns 404
// ---------------------------------------------------------------------------

test("GET /api/sessions/:id/decision returns 404 for unknown session", async (t) => {
  const { app } = await setupApp(t);

  const response = await app.inject({
    method: "GET",
    url: "/api/sessions/nonexistent-session/decision"
  });

  assert.equal(response.statusCode, 404);
});

test("POST /api/sessions/:id/decision returns 404 for unknown session", async (t) => {
  const { app } = await setupApp(t);

  const response = await app.inject({
    method: "POST",
    url: "/api/sessions/nonexistent-session/decision",
    payload: { decision: "approve" }
  });

  assert.equal(response.statusCode, 404);
});

// ---------------------------------------------------------------------------
// Reviewer decision – no decision yet returns 404
// ---------------------------------------------------------------------------

test("GET /api/sessions/:id/decision returns 404 when no decision has been saved", async (t) => {
  const { app } = await setupApp(t);

  const createResponse = await app.inject({
    method: "POST",
    url: "/api/sessions",
    payload: { manifest_id: "manifest-python-cli", candidate_id: "no-decision-test" }
  });
  assert.equal(createResponse.statusCode, 200);
  const session = createResponse.json() as { id: string };

  const decisionResponse = await app.inject({
    method: "GET",
    url: `/api/sessions/${session.id}/decision`
  });

  assert.equal(decisionResponse.statusCode, 404, "no decision saved → must return 404");
  const body = decisionResponse.json() as { error: string };
  assert.ok(body.error);
});

// ---------------------------------------------------------------------------
// Reviewer decision – malformed body
// ---------------------------------------------------------------------------

test("POST /api/sessions/:id/decision returns 400 for invalid decision value", async (t) => {
  const { app } = await setupApp(t);

  const createResponse = await app.inject({
    method: "POST",
    url: "/api/sessions",
    payload: { manifest_id: "manifest-python-cli", candidate_id: "bad-body-test" }
  });
  assert.equal(createResponse.statusCode, 200);
  const session = createResponse.json() as { id: string };

  const badResponse = await app.inject({
    method: "POST",
    url: `/api/sessions/${session.id}/decision`,
    payload: { decision: "not-a-valid-decision" }
  });

  assert.equal(badResponse.statusCode, 400, "invalid decision value must return 400");
});

test("POST /api/sessions/:id/decision returns 400 when decision field is missing", async (t) => {
  const { app } = await setupApp(t);

  const createResponse = await app.inject({
    method: "POST",
    url: "/api/sessions",
    payload: { manifest_id: "manifest-python-cli", candidate_id: "missing-decision-test" }
  });
  assert.equal(createResponse.statusCode, 200);
  const session = createResponse.json() as { id: string };

  const badResponse = await app.inject({
    method: "POST",
    url: `/api/sessions/${session.id}/decision`,
    payload: { note: "Some note, no decision key" }
  });

  assert.equal(badResponse.statusCode, 400, "missing decision field must return 400");
});

// ---------------------------------------------------------------------------
// Reviewer decision – note edge cases
// ---------------------------------------------------------------------------

test("POST /api/sessions/:id/decision persists empty-string note as absent", async (t) => {
  const { app } = await setupApp(t);

  const createResponse = await app.inject({
    method: "POST",
    url: "/api/sessions",
    payload: { manifest_id: "manifest-python-cli", candidate_id: "empty-note-test" }
  });
  assert.equal(createResponse.statusCode, 200);
  const session = createResponse.json() as { id: string };

  // Post with empty string note.
  const postResponse = await app.inject({
    method: "POST",
    url: `/api/sessions/${session.id}/decision`,
    payload: { decision: "approve", note: "" }
  });
  assert.equal(postResponse.statusCode, 200);
  const posted = postResponse.json() as { decision: string; note?: string };
  assert.equal(posted.decision, "approve");
  // Empty string note is either absent or an empty string; both are acceptable.
  // The important thing is it must not be a non-empty string.
  assert.ok(!posted.note || posted.note === "", "empty note should be absent or empty");
});

test("POST /api/sessions/:id/decision overwrites previous decision and removes note", async (t) => {
  const { app } = await setupApp(t);

  const createResponse = await app.inject({
    method: "POST",
    url: "/api/sessions",
    payload: { manifest_id: "manifest-python-cli", candidate_id: "overwrite-test" }
  });
  assert.equal(createResponse.statusCode, 200);
  const session = createResponse.json() as { id: string };

  // First: approve with a note.
  const firstPost = await app.inject({
    method: "POST",
    url: `/api/sessions/${session.id}/decision`,
    payload: { decision: "approve", note: "First pass looks solid." }
  });
  assert.equal(firstPost.statusCode, 200);
  const first = firstPost.json() as { decision: string; note?: string };
  assert.equal(first.decision, "approve");
  assert.equal(first.note, "First pass looks solid.");

  // Second: reject without a note.
  const secondPost = await app.inject({
    method: "POST",
    url: `/api/sessions/${session.id}/decision`,
    payload: { decision: "reject" }
  });
  assert.equal(secondPost.statusCode, 200);
  const second = secondPost.json() as { decision: string; note?: string };
  assert.equal(second.decision, "reject");
  assert.equal(second.note, undefined, "note must be absent after overwrite without note");

  // GET confirms the final state.
  const getResponse = await app.inject({
    method: "GET",
    url: `/api/sessions/${session.id}/decision`
  });
  assert.equal(getResponse.statusCode, 200);
  const final = getResponse.json() as { decision: string; note?: string };
  assert.equal(final.decision, "reject");
  assert.equal(final.note, undefined, "GET must reflect the latest overwritten decision");
});

// ---------------------------------------------------------------------------
// /api/runtime – latest_session_id and latest_scored_session_id
// ---------------------------------------------------------------------------

test("/api/runtime returns null for latest_session_id and latest_scored_session_id when no sessions exist", async (t) => {
  const { app } = await setupApp(t);

  const response = await app.inject({ method: "GET", url: "/api/runtime" });
  assert.equal(response.statusCode, 200);
  const runtime = response.json() as {
    latest_session_id: string | null;
    latest_scored_session_id: string | null;
  };

  assert.equal(runtime.latest_session_id, null);
  assert.equal(runtime.latest_scored_session_id, null);
});

test("/api/runtime returns latest_session_id after session creation", async (t) => {
  const { app } = await setupApp(t);

  const createResponse = await app.inject({
    method: "POST",
    url: "/api/sessions",
    payload: { manifest_id: "manifest-python-cli", candidate_id: "runtime-test" }
  });
  assert.equal(createResponse.statusCode, 200);
  const session = createResponse.json() as { id: string };

  const runtimeResponse = await app.inject({ method: "GET", url: "/api/runtime" });
  assert.equal(runtimeResponse.statusCode, 200);
  const runtime = runtimeResponse.json() as {
    latest_session_id: string | null;
    latest_scored_session_id: string | null;
  };

  assert.equal(runtime.latest_session_id, session.id);
  // Session is created but not scored yet; scored ID must still be null.
  assert.equal(runtime.latest_scored_session_id, null);
});

// ---------------------------------------------------------------------------
// POST /api/sessions/:id/status – invalid status value
// ---------------------------------------------------------------------------

test("POST /api/sessions/:id/status returns error for invalid status", async (t) => {
  const { app } = await setupApp(t);

  const createResponse = await app.inject({
    method: "POST",
    url: "/api/sessions",
    payload: { manifest_id: "manifest-python-cli", candidate_id: "status-test" }
  });
  assert.equal(createResponse.statusCode, 200);
  const session = createResponse.json() as { id: string };

  const statusResponse = await app.inject({
    method: "POST",
    url: `/api/sessions/${session.id}/status`,
    payload: { status: "not-a-valid-status" }
  });

  // Any non-200 indicates validation failed; typically 400 or 500.
  assert.notEqual(statusResponse.statusCode, 200, "invalid status must not return 200");
});

// ---------------------------------------------------------------------------
// POST /api/manifests – add and retrieve a new manifest
// ---------------------------------------------------------------------------

test("POST /api/manifests adds a new manifest retrievable via GET", async (t) => {
  const { app } = await setupApp(t);

  const newManifest = {
    id: "manifest-audit-test",
    name: "Audit Test Manifest",
    task_prompt: "Implement a binary search.",
    language: "python",
    allowed_ai_providers: ["openai"],
    allowed_sites: ["docs.python.org"],
    required_streams: ["desktop", "ide"],
    evidence_settings: {
      screenshots_enabled: false,
      screen_recording_metadata_only: true
    },
    decision_policy: {
      auto_advance_min_confidence: 0.9,
      auto_reject_enabled: false,
      require_full_completeness: true
    }
  };

  const postResponse = await app.inject({
    method: "POST",
    url: "/api/manifests",
    payload: newManifest
  });
  assert.equal(postResponse.statusCode, 200);
  const saved = postResponse.json() as { id: string };
  assert.equal(saved.id, "manifest-audit-test");

  const getResponse = await app.inject({ method: "GET", url: "/api/manifests" });
  assert.equal(getResponse.statusCode, 200);
  const manifests = getResponse.json() as Array<{ id: string }>;
  assert.ok(manifests.some((m) => m.id === "manifest-audit-test"), "new manifest must appear in list");
});

// ---------------------------------------------------------------------------
// Session list – ordering (newest first)
// ---------------------------------------------------------------------------

test("GET /api/sessions returns sessions newest first", async (t) => {
  const { app } = await setupApp(t);

  const first = await app.inject({
    method: "POST",
    url: "/api/sessions",
    payload: { manifest_id: "manifest-python-cli", candidate_id: "order-first" }
  });
  assert.equal(first.statusCode, 200);
  const firstSession = first.json() as { id: string };

  const second = await app.inject({
    method: "POST",
    url: "/api/sessions",
    payload: { manifest_id: "manifest-python-cli", candidate_id: "order-second" }
  });
  assert.equal(second.statusCode, 200);
  const secondSession = second.json() as { id: string };

  const listResponse = await app.inject({ method: "GET", url: "/api/sessions" });
  assert.equal(listResponse.statusCode, 200);
  const sessions = listResponse.json() as Array<{ id: string }>;

  assert.ok(sessions.length >= 2);
  // Newest (second) must appear before oldest (first).
  const firstIndex = sessions.findIndex((s) => s.id === firstSession.id);
  const secondIndex = sessions.findIndex((s) => s.id === secondSession.id);
  assert.ok(secondIndex < firstIndex, "newer session must appear before older session in the list");
});

// ---------------------------------------------------------------------------
// GET /api/sessions/:id/events – no events
// ---------------------------------------------------------------------------

test("GET /api/sessions/:id/events returns 404 when no events have been ingested", async (t) => {
  const { app } = await setupApp(t);

  const createResponse = await app.inject({
    method: "POST",
    url: "/api/sessions",
    payload: { manifest_id: "manifest-python-cli", candidate_id: "no-events-test" }
  });
  assert.equal(createResponse.statusCode, 200);
  const session = createResponse.json() as { id: string };

  const eventsResponse = await app.inject({
    method: "GET",
    url: `/api/sessions/${session.id}/events`
  });

  assert.equal(eventsResponse.statusCode, 404, "no events ingested → must return 404");
});
