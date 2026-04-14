import { buildControlPlaneApp } from "./app";
import { resolveControlPlaneRuntime } from "./runtime";

async function start(): Promise<void> {
  const runtime = resolveControlPlaneRuntime();
  const app = await buildControlPlaneApp(runtime);
  await app.listen({ port: runtime.port, host: runtime.host });
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
