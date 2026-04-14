import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { rm } from "node:fs/promises";
import net from "node:net";

const repoRoot = path.resolve(process.cwd());
const sharedDataDir = path.join(repoRoot, ".runtime-data", "local-demo");
const urls = {
  controlPlane: "http://127.0.0.1:4010",
  ingestion: "http://127.0.0.1:4020",
  analytics: "http://127.0.0.1:4030",
  reviewer: "http://127.0.0.1:4173",
  admin: "http://127.0.0.1:4174"
};
const shouldHideWindows = process.platform === "win32";

const childProcesses = [];

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

function spawnService(command, args, extraEnv = {}) {
  const resolved = resolveCommand(command, args);
  const child = spawn(resolved.command, resolved.args, {
    cwd: repoRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      ASSESSMENT_PLATFORM_ROOT: repoRoot,
      ASSESSMENT_DATA_DIR: sharedDataDir,
      CONTROL_PLANE_URL: urls.controlPlane,
      INGESTION_URL: urls.ingestion,
      ANALYTICS_URL: urls.analytics,
      REVIEWER_URL: urls.reviewer,
      ADMIN_URL: urls.admin,
      VITE_CONTROL_PLANE_URL: urls.controlPlane,
      ...extraEnv
    },
    windowsHide: shouldHideWindows
  });
  childProcesses.push(child);
  return child;
}

async function waitForHealthy(url, timeoutMs = 30000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Keep polling until timeout.
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function assertPortAvailable(port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", () => reject(new Error(`Port ${port} is already in use.`)));
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(undefined));
    });
  });
}

async function replayFixture() {
  const response = await fetch(`${urls.controlPlane}/api/demo/replay-fixture`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({})
  });
  if (!response.ok) {
    throw new Error(`Fixture replay failed: ${await response.text()}`);
  }
  return response.json();
}

function shutdown() {
  for (const child of childProcesses) {
    terminateChild(child);
  }
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

process.on("SIGINT", () => {
  shutdown();
  process.exit(0);
});
process.on("SIGTERM", () => {
  shutdown();
  process.exit(0);
});

async function main() {
  await assertPortAvailable(4010);
  await assertPortAvailable(4020);
  await assertPortAvailable(4030);
  await assertPortAvailable(4173);
  await assertPortAvailable(4174);
  await rm(sharedDataDir, { recursive: true, force: true });

  spawnService("node", ["scripts/run-local-service.mjs", "analytics"]);
  spawnService("npm", ["run", "dev:ingestion"]);
  spawnService("npm", ["run", "dev:control-plane"]);
  spawnService("npm", ["run", "dev:reviewer"]);
  spawnService("npm", ["run", "dev:admin"]);

  await waitForHealthy(`${urls.analytics}/health`);
  await waitForHealthy(`${urls.ingestion}/health`);
  await waitForHealthy(`${urls.controlPlane}/health`);

  const replay = await replayFixture();
  console.log("");
  console.log("Local demo is ready.");
  console.log(`Session ID: ${replay.session.id}`);
  console.log(`Reviewer: ${replay.reviewer_url}`);
  console.log(`Admin:    ${urls.admin}`);
  console.log(`HACI:     ${replay.scoring.haci_score}`);
  console.log(`Archetype:${replay.scoring.predicted_archetype}`);
  console.log("");
  console.log("Press Ctrl+C to stop all local demo services.");
}

main().catch((error) => {
  console.error(error);
  shutdown();
  process.exit(1);
});
