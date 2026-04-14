import path from "node:path";

export type IngestionRuntime = {
  host: string;
  port: number;
  dataRoot: string;
  sessionsDir: string;
};

export function resolveIngestionRuntime(): IngestionRuntime {
  const repoRoot = process.env.ASSESSMENT_PLATFORM_ROOT
    ? path.resolve(process.env.ASSESSMENT_PLATFORM_ROOT)
    : process.cwd();
  const dataDirEnv = process.env.ASSESSMENT_DATA_DIR ?? path.join(repoRoot, ".runtime-data");
  const dataRoot = path.isAbsolute(dataDirEnv) ? dataDirEnv : path.resolve(repoRoot, dataDirEnv);
  return {
    host: process.env.INGESTION_HOST ?? "0.0.0.0",
    port: Number(process.env.INGESTION_PORT ?? 4020),
    dataRoot,
    sessionsDir: path.join(dataRoot, "ingestion", "sessions")
  };
}

