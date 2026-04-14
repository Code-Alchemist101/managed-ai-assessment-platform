import path from "node:path";

export type ControlPlaneRuntime = {
  host: string;
  port: number;
  controlPlaneUrl: string;
  ingestionUrl: string;
  analyticsUrl: string;
  reviewerUrl: string;
  adminUrl: string;
  repoRoot: string;
  dataRoot: string;
  storageDir: string;
  manifestsFile: string;
  sessionsFile: string;
  scoringsDir: string;
  ingestionSessionsDir: string;
  fixturePath: string;
};

export function resolveControlPlaneRuntime(): ControlPlaneRuntime {
  const repoRoot = process.env.ASSESSMENT_PLATFORM_ROOT
    ? path.resolve(process.env.ASSESSMENT_PLATFORM_ROOT)
    : process.cwd();
  const host = process.env.CONTROL_PLANE_HOST ?? "0.0.0.0";
  const port = Number(process.env.CONTROL_PLANE_PORT ?? 4010);
  const controlPlaneUrl = process.env.CONTROL_PLANE_URL ?? `http://127.0.0.1:${port}`;
  const ingestionUrl = process.env.INGESTION_URL ?? "http://127.0.0.1:4020";
  const analyticsUrl = process.env.ANALYTICS_URL ?? "http://127.0.0.1:4030";
  const reviewerUrl = process.env.REVIEWER_URL ?? "http://127.0.0.1:4173";
  const adminUrl = process.env.ADMIN_URL ?? "http://127.0.0.1:4174";
  const dataDirEnv = process.env.ASSESSMENT_DATA_DIR ?? path.join(repoRoot, ".runtime-data");
  const dataRoot = path.isAbsolute(dataDirEnv) ? dataDirEnv : path.resolve(repoRoot, dataDirEnv);
  const storageDir = path.join(dataRoot, "control-plane");

  return {
    host,
    port,
    controlPlaneUrl,
    ingestionUrl,
    analyticsUrl,
    reviewerUrl,
    adminUrl,
    repoRoot,
    dataRoot,
    storageDir,
    manifestsFile: path.join(storageDir, "manifests.json"),
    sessionsFile: path.join(storageDir, "sessions.json"),
    scoringsDir: path.join(storageDir, "scorings"),
    ingestionSessionsDir: path.join(dataRoot, "ingestion", "sessions"),
    fixturePath: path.join(repoRoot, "fixtures", "sample-session.json")
  };
}

