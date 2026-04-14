import { spawn, spawnSync } from "node:child_process";
import path from "node:path";

const repoRoot = path.resolve(process.cwd());
const service = process.argv[2];
const shouldHideWindows = process.platform === "win32";

const sharedEnv = {
  ...process.env,
  ASSESSMENT_PLATFORM_ROOT: repoRoot,
  ASSESSMENT_DATA_DIR: path.join(repoRoot, ".runtime-data", "local-dev"),
  CONTROL_PLANE_URL: "http://127.0.0.1:4010",
  INGESTION_URL: "http://127.0.0.1:4020",
  ANALYTICS_URL: "http://127.0.0.1:4030",
  REVIEWER_URL: "http://127.0.0.1:4173",
  ADMIN_URL: "http://127.0.0.1:4174",
  VITE_CONTROL_PLANE_URL: "http://127.0.0.1:4010"
};

function resolveCommand(command, args) {
  if (process.platform !== "win32") {
    return { command, args };
  }

  if (command === "npm") {
    return {
      command: process.env.ComSpec ?? "cmd.exe",
      args: ["/d", "/s", "/c", "npm", ...args]
    };
  }

  return { command, args };
}

function spawnChild(command, args, extraEnv = {}) {
  const resolved = resolveCommand(command, args);
  const child = spawn(resolved.command, resolved.args, {
    cwd: repoRoot,
    stdio: "inherit",
    env: {
      ...sharedEnv,
      ...extraEnv
    },
    shell: false,
    windowsHide: shouldHideWindows
  });

  const shutdown = () => {
    terminateChild(child);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  child.on("exit", (code) => {
    process.exit(code ?? 0);
  });
}

function terminateChild(child) {
  if (!child.pid) {
    return;
  }

  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      shell: false,
      windowsHide: shouldHideWindows
    });
    return;
  }

  if (!child.killed) {
    child.kill();
  }
}

switch (service) {
  case "analytics":
    spawnChild(
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
        "4030"
      ],
      {
        ANALYTICS_PORT: "4030"
      }
    );
    break;
  case "control-plane":
    spawnChild("npm", ["run", "dev", "--workspace", "@assessment-platform/control-plane-api"]);
    break;
  case "ingestion":
    spawnChild("npm", ["run", "dev", "--workspace", "@assessment-platform/ingestion-api"]);
    break;
  case "reviewer":
    spawnChild("npm", [
      "run",
      "dev",
      "--workspace",
      "@assessment-platform/reviewer-web",
      "--",
      "--host",
      "127.0.0.1",
      "--port",
      "4173"
    ]);
    break;
  case "admin":
    spawnChild("npm", [
      "run",
      "dev",
      "--workspace",
      "@assessment-platform/admin-web",
      "--",
      "--host",
      "127.0.0.1",
      "--port",
      "4174"
    ]);
    break;
  case "desktop-controller":
    spawnChild("npm", ["run", "dev", "--workspace", "@assessment-platform/desktop-controller"]);
    break;
  default:
    console.error(
      "Unknown service. Expected one of: analytics, control-plane, ingestion, reviewer, admin, desktop-controller."
    );
    process.exit(1);
}
