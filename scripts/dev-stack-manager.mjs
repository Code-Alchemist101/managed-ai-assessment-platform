import { spawn, spawnSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { closeSync, existsSync, openSync } from "node:fs";
import net from "node:net";
import path from "node:path";

const repoRoot = path.resolve(process.cwd());
const dataDir = path.join(repoRoot, ".runtime-data", "local-dev");
const logsDir = path.join(dataDir, "stack-logs");
const stateFile = path.join(dataDir, "stack-state.json");

const args = process.argv.slice(2);
const command = args[0] ?? "status";
const manifestArgument = args.find((argument) => argument.startsWith("--manifest="));
const selectedManifestId = manifestArgument ? manifestArgument.split("=")[1] : undefined;
const skipBuild = args.includes("--skip-build");
const noDesktopController = args.includes("--no-desktop-controller");
const shouldHideWindows = process.platform === "win32";

const services = [
  {
    name: "analytics",
    commandArgs: ["scripts/run-local-service.mjs", "analytics"],
    healthUrl: "http://127.0.0.1:4030/health",
    port: 4030
  },
  {
    name: "ingestion",
    commandArgs: ["scripts/run-local-service.mjs", "ingestion"],
    healthUrl: "http://127.0.0.1:4020/health",
    port: 4020
  },
  {
    name: "control-plane",
    commandArgs: ["scripts/run-local-service.mjs", "control-plane"],
    healthUrl: "http://127.0.0.1:4010/health",
    port: 4010
  },
  {
    name: "reviewer",
    commandArgs: ["scripts/run-local-service.mjs", "reviewer"],
    healthUrl: "http://127.0.0.1:4173",
    port: 4173
  },
  {
    name: "admin",
    commandArgs: ["scripts/run-local-service.mjs", "admin"],
    healthUrl: "http://127.0.0.1:4174",
    port: 4174
  }
];

const desktopControllerService = {
  name: "desktop-controller",
  commandArgs: ["scripts/run-local-service.mjs", "desktop-controller"]
};

const sharedEnv = {
  ...process.env,
  ASSESSMENT_PLATFORM_ROOT: repoRoot,
  ASSESSMENT_DATA_DIR: dataDir,
  CONTROL_PLANE_URL: "http://127.0.0.1:4010",
  INGESTION_URL: "http://127.0.0.1:4020",
  ANALYTICS_URL: "http://127.0.0.1:4030",
  REVIEWER_URL: "http://127.0.0.1:4173",
  ADMIN_URL: "http://127.0.0.1:4174",
  VITE_CONTROL_PLANE_URL: "http://127.0.0.1:4010"
};

function resolveNpmCommand(npmArgs) {
  if (process.platform !== "win32") {
    return { command: "npm", args: npmArgs };
  }

  return {
    command: process.env.ComSpec ?? "cmd.exe",
    args: ["/d", "/s", "/c", "npm", ...npmArgs]
  };
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

async function ensurePortsAvailable() {
  for (const service of services) {
    await assertPortAvailable(service.port);
  }
}

async function waitForHealthy(url, timeoutMs = 60_000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return true;
      }
    } catch {
      // Keep polling until timeout.
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  return false;
}

async function readState() {
  if (!existsSync(stateFile)) {
    return null;
  }

  return JSON.parse(await readFile(stateFile, "utf8"));
}

function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function cleanupStaleState() {
  const state = await readState();
  if (!state) {
    return null;
  }

  const hasRunningProcess = state.processes?.some((processInfo) => isProcessRunning(processInfo.pid));
  if (hasRunningProcess) {
    return state;
  }

  await rm(stateFile, { force: true });
  return null;
}

function spawnDetachedService(service, extraEnv = {}) {
  const stdoutPath = path.join(logsDir, `${service.name}.stdout.log`);
  const stderrPath = path.join(logsDir, `${service.name}.stderr.log`);
  const stdoutFd = openSync(stdoutPath, "a");
  const stderrFd = openSync(stderrPath, "a");

  const child = spawn(process.execPath, service.commandArgs, {
    cwd: repoRoot,
    detached: true,
    stdio: ["ignore", stdoutFd, stderrFd],
    env: {
      ...sharedEnv,
      ...extraEnv
    },
    shell: false,
    windowsHide: shouldHideWindows
  });

  child.unref();
  closeSync(stdoutFd);
  closeSync(stderrFd);

  return {
    name: service.name,
    pid: child.pid,
    stdoutPath,
    stderrPath,
    healthUrl: service.healthUrl ?? null
  };
}

async function buildWorkspace() {
  const resolved = resolveNpmCommand(["run", "build"]);
  const result = spawnSync(resolved.command, resolved.args, {
    cwd: repoRoot,
    stdio: "inherit",
    env: sharedEnv,
    shell: false,
    windowsHide: shouldHideWindows
  });

  if (result.status !== 0) {
    throw new Error(`Build failed with code ${result.status ?? 1}.`);
  }
}

async function startCommand() {
  const existingState = await cleanupStaleState();
  if (existingState) {
    throw new Error(
      "A managed background stack is already recorded. Run `npm run dev:stack:status` or `npm run dev:stack:stop` first."
    );
  }

  await ensurePortsAvailable();
  await mkdir(logsDir, { recursive: true });

  if (!skipBuild) {
    console.log("[stack-manager] Building the workspace before startup...");
    await buildWorkspace();
  }

  const startedProcesses = [];

  try {
    for (const service of services) {
      startedProcesses.push(spawnDetachedService(service));
    }

    console.log("[stack-manager] Waiting for local services to become healthy...");
    for (const service of services) {
      const healthy = await waitForHealthy(service.healthUrl);
      if (!healthy) {
        throw new Error(`Timed out waiting for ${service.name} at ${service.healthUrl}.`);
      }
    }

    if (!noDesktopController) {
      startedProcesses.push(
        spawnDetachedService(
          desktopControllerService,
          selectedManifestId
            ? { ASSESSMENT_MANIFEST_ID: selectedManifestId }
            : {}
        )
      );
    }

    const state = {
      started_at: new Date().toISOString(),
      manifest_id: selectedManifestId ?? null,
      desktop_controller_started: !noDesktopController,
      processes: startedProcesses
    };

    await writeFile(stateFile, JSON.stringify(state, null, 2), "utf8");

    console.log("[stack-manager] Local background stack is ready.");
    console.log(`[stack-manager] Reviewer: http://127.0.0.1:4173`);
    console.log(`[stack-manager] Admin:    http://127.0.0.1:4174`);
    console.log(`[stack-manager] Control:  http://127.0.0.1:4010`);
    if (selectedManifestId) {
      console.log(`[stack-manager] Desktop manifest override: ${selectedManifestId}`);
    }
    console.log("[stack-manager] Use `npm run dev:stack:status` to inspect and `npm run dev:stack:stop` to shut it down.");
  } catch (error) {
    for (const processInfo of [...startedProcesses].reverse()) {
      killProcessTree(processInfo.pid);
    }
    throw error;
  }
}

async function fetchHealthSummary() {
  const entries = await Promise.all(
    services.map(async (service) => ({
      name: service.name,
      url: service.healthUrl,
      ok: await waitForHealthy(service.healthUrl, 1_500)
    }))
  );

  return entries;
}

async function statusCommand() {
  const state = await cleanupStaleState();
  const health = await fetchHealthSummary();

  if (!state) {
    console.log("[stack-manager] No managed background stack state file is present.");
  } else {
    console.log(`[stack-manager] Started at: ${state.started_at}`);
    console.log(`[stack-manager] Desktop controller started: ${state.desktop_controller_started ? "yes" : "no"}`);
    if (state.manifest_id) {
      console.log(`[stack-manager] Desktop manifest override: ${state.manifest_id}`);
    }
    console.log("[stack-manager] Process state:");
    for (const processInfo of state.processes) {
      console.log(
        `  - ${processInfo.name}: pid ${processInfo.pid}, ${isProcessRunning(processInfo.pid) ? "running" : "not running"}`
      );
    }
  }

  console.log("[stack-manager] Health checks:");
  for (const item of health) {
    console.log(`  - ${item.name}: ${item.ok ? "healthy" : "unreachable"} (${item.url})`);
  }
}

function killProcessTree(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return;
  }

  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
      shell: false,
      windowsHide: shouldHideWindows
    });
    return;
  }

  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // The process is already gone.
    }
  }
}

async function stopCommand() {
  const state = await readState();
  if (!state) {
    console.log("[stack-manager] No managed background stack state file found.");
    return;
  }

  const processes = [...(state.processes ?? [])].reverse();
  for (const processInfo of processes) {
    killProcessTree(processInfo.pid);
  }

  await rm(stateFile, { force: true });
  console.log("[stack-manager] Managed background stack stopped.");
}

async function main() {
  switch (command) {
    case "start":
      await startCommand();
      break;
    case "status":
      await statusCommand();
      break;
    case "stop":
      await stopCommand();
      break;
    default:
      throw new Error("Unknown command. Expected: start, status, stop.");
  }
}

main().catch((error) => {
  console.error(`[stack-manager] ${error.message}`);
  process.exit(1);
});
