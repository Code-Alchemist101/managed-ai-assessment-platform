import { spawn, spawnSync } from "node:child_process";
import path from "node:path";

const repoRoot = path.resolve(process.cwd());
const shouldHideWindows = process.platform === "win32";
const args = [
  "-m",
  "uvicorn",
  "assessment_analytics.app:app",
  "--app-dir",
  path.join(repoRoot, "services", "analytics-py"),
  "--host",
  "127.0.0.1",
  "--port",
  process.env.ANALYTICS_PORT ?? "4030"
];

const child = spawn("python", args, {
  cwd: repoRoot,
  stdio: "inherit",
  env: {
    ...process.env,
    ASSESSMENT_PLATFORM_ROOT: repoRoot
  },
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

function terminateChild(processHandle) {
  if (!processHandle.pid) {
    return;
  }

  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(processHandle.pid), "/T", "/F"], {
      stdio: "ignore",
      shell: false,
      windowsHide: shouldHideWindows
    });
    return;
  }

  if (!processHandle.killed) {
    processHandle.kill();
  }
}
