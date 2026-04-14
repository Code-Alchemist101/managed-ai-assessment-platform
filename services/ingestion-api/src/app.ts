import Fastify, { type FastifyInstance } from "fastify";
import { mkdir, appendFile, readFile } from "node:fs/promises";
import path from "node:path";
import { EventEnvelopeSchema } from "@assessment-platform/contracts";
import { resolveIngestionRuntime, type IngestionRuntime } from "./runtime";

const sessionFilePath = (runtime: IngestionRuntime, sessionId: string) => path.join(runtime.sessionsDir, `${sessionId}.ndjson`);

async function ensureDirs(runtime: IngestionRuntime): Promise<void> {
  await mkdir(runtime.sessionsDir, { recursive: true });
}

export async function buildIngestionApp(
  runtime: IngestionRuntime = resolveIngestionRuntime()
): Promise<FastifyInstance> {
  await ensureDirs(runtime);
  const app = Fastify({ logger: true });

  app.get("/health", async () => ({ status: "ok" }));

  app.post("/api/events", async (request, reply) => {
    const body = request.body as { events?: unknown[]; event?: unknown };
    const candidateEvents = Array.isArray(body?.events) ? body.events : body?.event ? [body.event] : [];
    if (!candidateEvents.length) {
      return reply.status(400).send({ error: "Expected an `events` array or single `event` payload." });
    }

    await ensureDirs(runtime);
    const parsedEvents = candidateEvents.map((event) => EventEnvelopeSchema.parse(event));

    for (const event of parsedEvents) {
      await appendFile(sessionFilePath(runtime, event.session_id), JSON.stringify(event) + "\n", "utf8");
    }

    return reply.send({
      received: parsedEvents.length,
      session_ids: [...new Set(parsedEvents.map((event) => event.session_id))]
    });
  });

  app.get("/api/sessions/:sessionId/events", async (request, reply) => {
    const sessionId = (request.params as { sessionId: string }).sessionId;
    try {
      const contents = await readFile(sessionFilePath(runtime, sessionId), "utf8");
      const events = contents
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line));
      return reply.send({ session_id: sessionId, events });
    } catch {
      return reply.status(404).send({ error: "Session events not found." });
    }
  });

  return app;
}
