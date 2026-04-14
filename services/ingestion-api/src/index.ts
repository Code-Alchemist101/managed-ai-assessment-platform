import { buildIngestionApp } from "./app";
import { resolveIngestionRuntime } from "./runtime";

async function start(): Promise<void> {
  const runtime = resolveIngestionRuntime();
  const app = await buildIngestionApp(runtime);
  await app.listen({ port: runtime.port, host: runtime.host });
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
