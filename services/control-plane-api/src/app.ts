import Fastify, { type FastifyInstance } from "fastify";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { z } from "zod";
import {
  EventEnvelopeSchema,
  LocalRuntimeConfigSchema,
  SessionManifestSchema,
  SessionBootstrapSchema,
  SessionDetailSchema,
  SessionScoringPayloadSchema,
  SessionStatusSchema,
  ReviewerDecisionSchema,
  type EventEnvelope,
  type SessionBootstrap,
  type SessionManifest,
  type SessionDetail,
  type SessionScoringPayload,
  type SessionSummary,
  type ReviewerDecision
} from "@assessment-platform/contracts";
import { resolveControlPlaneRuntime, type ControlPlaneRuntime } from "./runtime";

type StoredSession = SessionSummary;
type StoredManifest = SessionManifest;
type ScoreSessionError = {
  error: {
    statusCode: number;
    body: {
      error: string;
      detail?: string;
    };
  };
};
type ScoreSessionSuccess = {
  session: StoredSession;
  scoring: SessionScoringPayload;
};
type ScoreSessionResult = ScoreSessionError | ScoreSessionSuccess;

const defaultManifests = [
  {
    id: "manifest-python-cli",
    name: "Python CLI Assessment",
    task_prompt: "Build a Python CLI todo manager with add, list, and complete commands.",
    language: "python",
    allowed_ai_providers: ["openai", "anthropic", "google"],
    allowed_sites: [
      "chat.openai.com",
      "claude.ai",
      "gemini.google.com",
      "stackoverflow.com",
      "developer.mozilla.org",
      "docs.python.org",
      "www.google.com"
    ],
    required_streams: ["desktop", "ide", "browser"],
    evidence_settings: {
      screenshots_enabled: false,
      screen_recording_metadata_only: true
    },
    decision_policy: {
      auto_advance_min_confidence: 0.9,
      auto_reject_enabled: false,
      require_full_completeness: true
    }
  },
  {
    id: "manifest-python-cli-live-desktop-ide",
    name: "Python CLI Assessment (Desktop + VS Code Live)",
    task_prompt: "Build a Python CLI todo manager with add, list, and complete commands.",
    language: "python",
    allowed_ai_providers: ["openai", "anthropic", "google"],
    allowed_sites: [
      "chat.openai.com",
      "claude.ai",
      "gemini.google.com",
      "stackoverflow.com",
      "developer.mozilla.org",
      "docs.python.org",
      "www.google.com"
    ],
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
  },
  {
    id: "manifest-python-cli-live-full",
    name: "Python CLI Assessment (Desktop + VS Code + Edge Live)",
    task_prompt: "Build a Python CLI todo manager with add, list, and complete commands.",
    language: "python",
    allowed_ai_providers: ["openai", "anthropic", "google"],
    allowed_sites: [
      "chat.openai.com",
      "claude.ai",
      "gemini.google.com",
      "stackoverflow.com",
      "developer.mozilla.org",
      "docs.python.org",
      "www.google.com"
    ],
    required_streams: ["desktop", "ide", "browser"],
    evidence_settings: {
      screenshots_enabled: false,
      screen_recording_metadata_only: true
    },
    decision_policy: {
      auto_advance_min_confidence: 0.9,
      auto_reject_enabled: false,
      require_full_completeness: true
    }
  }
];

const readJson = async <T>(filePath: string): Promise<T> => JSON.parse(await readFile(filePath, "utf8")) as T;
const writeJson = async (filePath: string, value: unknown) => writeFile(filePath, JSON.stringify(value, null, 2), "utf8");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function safeSessionId(sessionId: string): string {
  if (!UUID_PATTERN.test(sessionId)) {
    throw new Error("Invalid session ID format.");
  }
  return sessionId;
}

function scoringFilePath(runtime: ControlPlaneRuntime, sessionId: string): string {
  return path.join(runtime.scoringsDir, `${safeSessionId(sessionId)}.json`);
}

function reviewDecisionFilePath(runtime: ControlPlaneRuntime, sessionId: string): string {
  return path.join(runtime.reviewDecisionsDir, `${safeSessionId(sessionId)}.json`);
}

function sessionEventsPath(runtime: ControlPlaneRuntime, sessionId: string): string {
  return path.join(runtime.ingestionSessionsDir, `${safeSessionId(sessionId)}.ndjson`);
}

async function ensureStorage(runtime: ControlPlaneRuntime): Promise<void> {
  await mkdir(runtime.storageDir, { recursive: true });
  await mkdir(runtime.scoringsDir, { recursive: true });
  await mkdir(runtime.reviewDecisionsDir, { recursive: true });
  try {
    const storedManifests = await readJson<typeof defaultManifests>(runtime.manifestsFile);
    const nextManifests = [...storedManifests];
    for (const manifest of defaultManifests) {
      if (!nextManifests.some((item) => item.id === manifest.id)) {
        nextManifests.push(manifest);
      }
    }
    if (nextManifests.length !== storedManifests.length) {
      await writeJson(runtime.manifestsFile, nextManifests);
    }
  } catch {
    await writeJson(runtime.manifestsFile, defaultManifests);
  }
  try {
    await readFile(runtime.sessionsFile, "utf8");
  } catch {
    await writeJson(runtime.sessionsFile, []);
  }
}

async function loadSessions(runtime: ControlPlaneRuntime): Promise<StoredSession[]> {
  return readJson<StoredSession[]>(runtime.sessionsFile);
}

async function saveSessions(runtime: ControlPlaneRuntime, sessions: StoredSession[]): Promise<void> {
  await writeJson(runtime.sessionsFile, sessions);
}

async function loadManifests(runtime: ControlPlaneRuntime): Promise<StoredManifest[]> {
  return readJson<StoredManifest[]>(runtime.manifestsFile);
}

function sortSessionsNewestFirst(sessions: StoredSession[]): StoredSession[] {
  return [...sessions].sort((left, right) => right.created_at.localeCompare(left.created_at));
}

function buildRuntimePayload(runtime: ControlPlaneRuntime, sessions: StoredSession[]) {
  const sorted = sortSessionsNewestFirst(sessions);
  const latestSessionId = sorted[0]?.id ?? null;
  const latestScoredSessionId = sorted.find((session) => session.status === "scored")?.id ?? null;
  return LocalRuntimeConfigSchema.parse({
    control_plane_url: runtime.controlPlaneUrl,
    ingestion_url: `${runtime.ingestionUrl}/api/events`,
    analytics_url: runtime.analyticsUrl,
    reviewer_url: runtime.reviewerUrl,
    admin_url: runtime.adminUrl,
    assessment_data_dir: runtime.dataRoot,
    latest_session_id: latestSessionId,
    latest_scored_session_id: latestScoredSessionId
  });
}

async function createSessionRecord(
  runtime: ControlPlaneRuntime,
  manifestId: string,
  candidateId: string
): Promise<StoredSession> {
  const sessions = await loadSessions(runtime);
  const now = new Date().toISOString();
  const session: StoredSession = {
    id: crypto.randomUUID(),
    manifest_id: manifestId,
    candidate_id: candidateId,
    created_at: now,
    updated_at: now,
    status: "created",
    has_scoring: false
  };
  sessions.push(session);
  await saveSessions(runtime, sessions);
  return session;
}

async function updateSessionStatus(
  runtime: ControlPlaneRuntime,
  sessionId: string,
  status: StoredSession["status"]
): Promise<StoredSession | null> {
  const sessions = await loadSessions(runtime);
  const session = sessions.find((item) => item.id === sessionId);
  if (!session) {
    return null;
  }
  session.status = status;
  session.updated_at = new Date().toISOString();
  await saveSessions(runtime, sessions);
  return session;
}

async function readSessionEvents(runtime: ControlPlaneRuntime, sessionId: string): Promise<EventEnvelope[]> {
  const contents = await readFile(sessionEventsPath(runtime, sessionId), "utf8");
  return contents
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => EventEnvelopeSchema.parse(JSON.parse(line)));
}

async function persistScoring(runtime: ControlPlaneRuntime, sessionId: string, scoring: unknown): Promise<void> {
  await writeJson(scoringFilePath(runtime, sessionId), scoring);
}

async function readScoring(runtime: ControlPlaneRuntime, sessionId: string): Promise<unknown> {
  return readJson(scoringFilePath(runtime, sessionId));
}

async function tryReadScoring(runtime: ControlPlaneRuntime, sessionId: string): Promise<SessionScoringPayload | null> {
  try {
    return SessionScoringPayloadSchema.parse(await readScoring(runtime, sessionId));
  } catch {
    return null;
  }
}

async function persistReviewDecision(runtime: ControlPlaneRuntime, decision: ReviewerDecision): Promise<void> {
  await writeJson(reviewDecisionFilePath(runtime, decision.session_id), decision);
}

async function tryReadReviewDecision(runtime: ControlPlaneRuntime, sessionId: string): Promise<ReviewerDecision | null> {
  try {
    return ReviewerDecisionSchema.parse(await readJson(reviewDecisionFilePath(runtime, sessionId)));
  } catch {
    return null;
  }
}

function buildEventCountsBySource(events: EventEnvelope[]): Record<string, number> {
  const counts = new Map<string, number>();
  for (const event of events) {
    counts.set(event.source, (counts.get(event.source) ?? 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function buildPresentStreams(eventCountsBySource: Record<string, number>): string[] {
  return Object.entries(eventCountsBySource)
    .filter(([, count]) => count > 0)
    .map(([source]) => source)
    .sort((left, right) => left.localeCompare(right));
}

function buildMissingStreams(requiredStreams: string[], presentStreams: string[]): string[] {
  const present = new Set(presentStreams);
  return requiredStreams.filter((stream) => !present.has(stream));
}

function timestampOrNull(value: string | undefined): string | null {
  return value ?? null;
}

async function buildSessionDetail(
  runtime: ControlPlaneRuntime,
  session: StoredSession,
  manifests: StoredManifest[]
): Promise<SessionDetail> {
  const manifest = manifests.find((item) => item.id === session.manifest_id);
  const events = await readSessionEvents(runtime, session.id).catch(() => []);
  const scoring = await tryReadScoring(runtime, session.id);
  const eventCountsBySource = buildEventCountsBySource(events);
  const presentStreams = buildPresentStreams(eventCountsBySource);
  const missingStreams = scoring?.integrity.missing_streams ?? buildMissingStreams(manifest?.required_streams ?? [], presentStreams);
  const firstEventAt = events[0]?.timestamp_utc;
  const lastEventAt = events.at(-1)?.timestamp_utc;

  return SessionDetailSchema.parse({
    ...session,
    manifest_name: manifest?.name ?? session.manifest_id,
    required_streams: manifest?.required_streams ?? [],
    present_streams: presentStreams,
    event_counts_by_source: eventCountsBySource,
    first_event_at: timestampOrNull(firstEventAt),
    last_event_at: timestampOrNull(lastEventAt),
    integrity_verdict: scoring?.integrity.verdict ?? null,
    missing_streams: missingStreams,
    policy_recommendation: scoring?.policy_recommendation ?? null,
    invalidation_reasons: scoring?.feature_vector.invalidation_reasons ?? [],
    haci_score: scoring?.haci_score ?? null,
    predicted_archetype: scoring?.predicted_archetype ?? null
  });
}

async function buildSessionDetails(runtime: ControlPlaneRuntime, sessions: StoredSession[]): Promise<SessionDetail[]> {
  const manifests = await loadManifests(runtime);
  const sortedSessions = sortSessionsNewestFirst(sessions);
  return Promise.all(sortedSessions.map((session) => buildSessionDetail(runtime, session, manifests)));
}

async function buildSessionBootstrap(
  runtime: ControlPlaneRuntime,
  sessionId: string
): Promise<{ session: StoredSession; manifest: StoredManifest; bootstrap: SessionBootstrap } | null> {
  const [sessions, manifests] = await Promise.all([loadSessions(runtime), loadManifests(runtime)]);
  const session = sessions.find((item) => item.id === sessionId);
  if (!session) {
    return null;
  }

  const manifest = manifests.find((item) => item.id === session.manifest_id);
  if (!manifest) {
    return null;
  }

  return {
    session,
    manifest,
    bootstrap: SessionBootstrapSchema.parse({
      session_id: session.id,
      manifest_id: manifest.id,
      control_plane_url: runtime.controlPlaneUrl,
      ingestion_event_endpoint: `${runtime.ingestionUrl}/api/events`,
      reviewer_url: runtime.reviewerUrl,
      allowed_ai_providers: manifest.allowed_ai_providers,
      allowed_sites: manifest.allowed_sites,
      required_streams: manifest.required_streams
    })
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function resequenceEvents(events: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const sequenceBySource = new Map<string, number>();
  return events.map((event) => {
    const source = String(event.source ?? "system");
    const nextSequence = (sequenceBySource.get(source) ?? 0) + 1;
    sequenceBySource.set(source, nextSequence);
    return {
      ...event,
      sequence_no: nextSequence
    };
  });
}

function isScoreSessionError(result: ScoreSessionResult): result is ScoreSessionError {
  return "error" in result;
}

async function scoreSession(runtime: ControlPlaneRuntime, sessionId: string): Promise<ScoreSessionResult> {
  const sessions = await loadSessions(runtime);
  const session = sessions.find((item) => item.id === sessionId);
  if (!session) {
    return { error: { statusCode: 404, body: { error: "Session not found." } } };
  }

  const manifests = await loadManifests(runtime);
  const manifest = manifests.find((item) => item.id === session.manifest_id);
  if (!manifest) {
    return { error: { statusCode: 404, body: { error: "Manifest not found." } } };
  }

  let events: unknown[] = [];
  try {
    events = await readSessionEvents(runtime, sessionId);
  } catch {
    return { error: { statusCode: 404, body: { error: "No ingested events found for session." } } };
  }

  const analyticsResponse = await fetch(`${runtime.analyticsUrl}/score-session`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      session_context: {
        session_id: session.id,
        problem_statement: manifest.task_prompt,
        allowed_ai_providers: manifest.allowed_ai_providers,
        allowed_sites: manifest.allowed_sites,
        required_streams: manifest.required_streams
      },
      events
    })
  });

  if (!analyticsResponse.ok) {
    return {
      error: {
        statusCode: 502,
        body: {
          error: "Analytics service failed.",
          detail: await analyticsResponse.text()
        }
      }
    };
  }

  const scoring = SessionScoringPayloadSchema.parse(await analyticsResponse.json());
  session.updated_at = new Date().toISOString();
  session.has_scoring = true;
  session.status = scoring.integrity.verdict === "invalid" ? "invalid" : "scored";
  await saveSessions(runtime, sessions);
  await persistScoring(runtime, sessionId, scoring);
  return {
    session,
    scoring
  };
}

export async function buildControlPlaneApp(
  runtime: ControlPlaneRuntime = resolveControlPlaneRuntime()
): Promise<FastifyInstance> {
  await ensureStorage(runtime);
  const app = Fastify({ logger: true });

  app.addHook("onRequest", async (request, reply) => {
    reply.header("Access-Control-Allow-Origin", "*");
    reply.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    reply.header("Access-Control-Allow-Headers", "Content-Type");

    if (request.method === "OPTIONS") {
      return reply.status(204).send();
    }
  });

  app.get("/health", async () => ({ status: "ok" }));

  app.get("/api/runtime", async () => {
    const sessions = await loadSessions(runtime);
    return buildRuntimePayload(runtime, sessions);
  });

  app.get("/api/manifests", async () => loadManifests(runtime));

  app.post("/api/manifests", async (request) => {
    const manifest = SessionManifestSchema.parse(request.body);
    const manifests = await loadManifests(runtime);
    manifests.push(manifest);
    await writeJson(runtime.manifestsFile, manifests);
    return manifest;
  });

  app.get("/api/sessions", async () => buildSessionDetails(runtime, await loadSessions(runtime)));

  app.post("/api/sessions", async (request, reply) => {
    const body = request.body as { manifest_id?: string; candidate_id?: string };
    if (!body?.manifest_id || !body?.candidate_id) {
      return reply.status(400).send({ error: "manifest_id and candidate_id are required." });
    }
    const session = await createSessionRecord(runtime, body.manifest_id, body.candidate_id);
    return session;
  });

  app.get("/api/sessions/:sessionId", async (request, reply) => {
    const sessionId = (request.params as { sessionId: string }).sessionId;
    const [sessions, manifests] = await Promise.all([loadSessions(runtime), loadManifests(runtime)]);
    const session = sessions.find((item) => item.id === sessionId);
    if (!session) {
      return reply.status(404).send({ error: "Session not found." });
    }
    return buildSessionDetail(runtime, session, manifests);
  });

  app.get("/api/sessions/:sessionId/bootstrap", async (request, reply) => {
    const sessionId = (request.params as { sessionId: string }).sessionId;
    const bootstrapContext = await buildSessionBootstrap(runtime, sessionId);
    if (!bootstrapContext) {
      return reply.status(404).send({ error: "Session bootstrap context not found." });
    }
    return bootstrapContext.bootstrap;
  });

  app.post("/api/sessions/:sessionId/status", async (request, reply) => {
    const sessionId = (request.params as { sessionId: string }).sessionId;
    const body = request.body as { status?: string };
    if (!body?.status) {
      return reply.status(400).send({ error: "status is required." });
    }
    const status = SessionStatusSchema.parse(body.status);
    const session = await updateSessionStatus(runtime, sessionId, status);
    if (!session) {
      return reply.status(404).send({ error: "Session not found." });
    }
    return session;
  });

  app.get("/api/sessions/:sessionId/events", async (request, reply) => {
    const sessionId = (request.params as { sessionId: string }).sessionId;
    try {
      const events = await readSessionEvents(runtime, sessionId);
      return { session_id: sessionId, events };
    } catch {
      return reply.status(404).send({ error: "Session events not found." });
    }
  });

  app.get("/api/sessions/:sessionId/scoring", async (request, reply) => {
    const sessionId = (request.params as { sessionId: string }).sessionId;
    try {
      return SessionScoringPayloadSchema.parse(await readScoring(runtime, sessionId));
    } catch {
      return reply.status(404).send({ error: "Scoring payload not found." });
    }
  });

  app.post("/api/sessions/:sessionId/score", async (request, reply) => {
    const sessionId = (request.params as { sessionId: string }).sessionId;
    const result = await scoreSession(runtime, sessionId);
    if (isScoreSessionError(result)) {
      return reply.status(result.error.statusCode).send(result.error.body);
    }
    return result;
  });

  app.get("/api/sessions/:sessionId/decision", async (request, reply) => {
    const sessionId = (request.params as { sessionId: string }).sessionId;
    const sessions = await loadSessions(runtime);
    if (!sessions.some((item) => item.id === sessionId)) {
      return reply.status(404).send({ error: "Session not found." });
    }
    const decision = await tryReadReviewDecision(runtime, sessionId);
    if (!decision) {
      return reply.status(404).send({ error: "No reviewer decision recorded for this session." });
    }
    return decision;
  });

  app.post("/api/sessions/:sessionId/decision", async (request, reply) => {
    const sessionId = (request.params as { sessionId: string }).sessionId;
    const sessions = await loadSessions(runtime);
    if (!sessions.some((item) => item.id === sessionId)) {
      return reply.status(404).send({ error: "Session not found." });
    }
    const bodySchema = z.object({
      decision: ReviewerDecisionSchema.shape.decision,
      note: z.string().optional()
    });
    const bodyResult = bodySchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.status(400).send({ error: "Invalid request body.", detail: bodyResult.error.message });
    }
    const decision = ReviewerDecisionSchema.parse({
      session_id: sessionId,
      decision: bodyResult.data.decision,
      note: bodyResult.data.note,
      decided_at: new Date().toISOString()
    });
    await persistReviewDecision(runtime, decision);
    return decision;
  });

  app.post("/api/demo/replay-fixture", async (request, reply) => {
    const body = (request.body as { manifest_id?: string; candidate_id?: string } | undefined) ?? {};
    const manifests = await loadManifests(runtime);
    const manifest = body.manifest_id
      ? manifests.find((item) => item.id === body.manifest_id)
      : manifests[0];
    if (!manifest) {
      return reply.status(404).send({ error: "Manifest not found." });
    }

    const session = await createSessionRecord(runtime, manifest.id, body.candidate_id ?? "cand-demo-local");
    await updateSessionStatus(runtime, session.id, "active");

    const fixture = JSON.parse(await readFile(runtime.fixturePath, "utf8")) as {
      session_context: Record<string, unknown>;
      events: Array<Record<string, unknown>>;
    };
    const reboundEvents = resequenceEvents(
      fixture.events.map((event) => ({
        ...event,
        session_id: session.id
      }))
    );

    const ingestResponse = await fetch(`${runtime.ingestionUrl}/api/events`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ events: reboundEvents })
    });

    if (!ingestResponse.ok) {
      return reply.status(502).send({
        error: "Ingestion service failed.",
        detail: await ingestResponse.text()
      });
    }

    await updateSessionStatus(runtime, session.id, "submitted");
    const scored = await scoreSession(runtime, session.id);
    if (isScoreSessionError(scored)) {
      return reply.status(scored.error.statusCode).send(scored.error.body);
    }

    return {
      session: scored.session,
      scoring: scored.scoring,
      runtime: buildRuntimePayload(runtime, await loadSessions(runtime)),
      reviewer_url: `${runtime.reviewerUrl}?sessionId=${scored.session.id}`
    };
  });

  app.get("/browser-bootstrap", async (request, reply) => {
    const sessionId = (request.query as { sessionId?: string }).sessionId;
    if (!sessionId) {
      return reply.status(400).type("text/html").send("<h1>Missing sessionId</h1>");
    }

    const bootstrapContext = await buildSessionBootstrap(runtime, sessionId);
    if (!bootstrapContext) {
      return reply.status(404).type("text/html").send("<h1>Session bootstrap not found</h1>");
    }

    const { session, manifest, bootstrap } = bootstrapContext;
    const allowedSites = manifest.allowed_sites.map((site) => `<li>${escapeHtml(site)}</li>`).join("");
    const requiredStreams = manifest.required_streams.map((stream) => `<li>${escapeHtml(stream)}</li>`).join("");
    return reply
      .type("text/html")
      .send(`
<!doctype html>
<html lang="en">
  <body style="font-family: Segoe UI, sans-serif; margin:0; padding:24px; background:linear-gradient(160deg, #111827, #1d4ed8); color:#e5eefb;">
    <main style="max-width:900px; margin:0 auto; display:grid; gap:18px;">
      <header>
        <p style="margin:0 0 8px; letter-spacing:0.18em; text-transform:uppercase; font-size:12px;">Managed Browser Bootstrap</p>
        <h1 style="margin:0 0 12px;">Edge Session Ready</h1>
        <p style="margin:0; max-width:680px;">
          This Edge profile is now pinned to session <strong>${escapeHtml(session.id)}</strong>. The managed extension will
          attribute browser navigation and activation events to this exact session instead of using the latest session heuristic.
        </p>
      </header>
      <section style="display:grid; gap:16px; grid-template-columns:repeat(auto-fit, minmax(260px, 1fr));">
        <article style="background:rgba(15,23,42,0.55); border-radius:18px; padding:18px;">
          <h2 style="margin-top:0;">Session</h2>
          <p style="margin:0 0 8px;">Manifest: ${escapeHtml(manifest.name)}</p>
          <p style="margin:0 0 8px;">Candidate: ${escapeHtml(session.candidate_id)}</p>
          <p style="margin:0;">Reviewer: <a href="${escapeHtml(`${runtime.reviewerUrl}?sessionId=${session.id}`)}" style="color:#bfdbfe;">Open session</a></p>
        </article>
        <article style="background:rgba(15,23,42,0.55); border-radius:18px; padding:18px;">
          <h2 style="margin-top:0;">Required Streams</h2>
          <ul style="margin:0; padding-left:20px;">${requiredStreams}</ul>
        </article>
        <article style="background:rgba(15,23,42,0.55); border-radius:18px; padding:18px;">
          <h2 style="margin-top:0;">Allowed Sites</h2>
          <ul style="margin:0; padding-left:20px;">${allowedSites}</ul>
        </article>
      </section>
      <section style="background:rgba(15,23,42,0.55); border-radius:18px; padding:18px;">
        <h2 style="margin-top:0;">Bootstrap Context</h2>
        <pre style="white-space:pre-wrap; margin:0;">${escapeHtml(JSON.stringify(bootstrap, null, 2))}</pre>
      </section>
    </main>
  </body>
</html>
`);
  });

  return app;
}
