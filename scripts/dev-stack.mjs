import { spawn, spawnSync } from "node:child_process";
import path from "node:path";

const repoRoot = path.resolve(process.cwd());
const args = process.argv.slice(2);
const manifestArgument = args.find((argument) => argument.startsWith("--manifest="));
const selectedManifestId = manifestArgument ? manifestArgument.split("=")[1] : undefined;
const skipBuild = args.includes("--skip-build");
const noDesktopController = args.includes("--no-desktop-controller");
const smokeMode = args.includes("--smoke");
const shouldHideWindows = process.platform === "win32";

const urls = {
  analytics: "http://127.0.0.1:4030/health",
  ingestion: "http://127.0.0.1:4020/health",
  controlPlane: "http://127.0.0.1:4010/health",
  reviewer: "http://127.0.0.1:4173",
  admin: "http://127.0.0.1:4174"
};

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

const childProcesses = [];
let shuttingDown = false;

function resolveCommand(command, commandArgs) {
  if (process.platform !== "win32") {
    return { command, args: commandArgs };
  }

  if (command === "npm") {
    return {
      command: process.env.ComSpec ?? "cmd.exe",
      args: ["/d", "/s", "/c", "npm", ...commandArgs]
    };
  }

  return { command, args: commandArgs };
}

function pipeOutput(stream, prefix, targetStream) {
  let remainder = "";

  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    const lines = `${remainder}${chunk}`.split(/\r?\n/);
    remainder = lines.pop() ?? "";
    for (const line of lines) {
      targetStream.write(`${prefix}${line}\n`);
    }
  });

  stream.on("end", () => {
    if (remainder) {
      targetStream.write(`${prefix}${remainder}\n`);
      remainder = "";
    }
  });
}

function spawnManagedProcess(name, command, commandArgs, extraEnv = {}) {
  const resolved = resolveCommand(command, commandArgs);
  const child = spawn(resolved.command, resolved.args, {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...sharedEnv,
      ...extraEnv
    },
    shell: false,
    windowsHide: shouldHideWindows
  });

  childProcesses.push(child);
  pipeOutput(child.stdout, `[${name}] `, process.stdout);
  pipeOutput(child.stderr, `[${name}] `, process.stderr);

  child.on("exit", (code, signal) => {
    if (!shuttingDown) {
      process.stderr.write(
        `[${name}] exited unexpectedly with ${signal ? `signal ${signal}` : `code ${code ?? 0}`}\n`
      );
    }
  });

  child.on("error", (error) => {
    if (!shuttingDown) {
      process.stderr.write(`[${name}] failed to start: ${error.message}\n`);
    }
  });

  return child;
}

function runCommand(name, command, commandArgs, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const resolved = resolveCommand(command, commandArgs);
    const child = spawn(resolved.command, resolved.args, {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...sharedEnv,
        ...extraEnv
      },
      shell: false,
      windowsHide: shouldHideWindows
    });

    pipeOutput(child.stdout, `[${name}] `, process.stdout);
    pipeOutput(child.stderr, `[${name}] `, process.stderr);

    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve(undefined);
        return;
      }
      reject(new Error(`${name} exited with code ${code ?? 0}.`));
    });
  });
}

async function waitForHealthy(url, timeoutMs = 60_000) {
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
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  throw new Error(`Timed out waiting for ${url}`);
}

function shutdown() {
  shuttingDown = true;
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
  if (!skipBuild) {
    process.stdout.write("[stack] Building the workspace before startup...\n");
    await runCommand("build", "npm", ["run", "build"]);
  }

  process.stdout.write("[stack] Starting analytics, ingestion, control plane, reviewer, and admin...\n");
  spawnManagedProcess("analytics", "node", ["scripts/run-local-service.mjs", "analytics"]);
  spawnManagedProcess("ingestion", "node", ["scripts/run-local-service.mjs", "ingestion"]);
  spawnManagedProcess("control-plane", "node", ["scripts/run-local-service.mjs", "control-plane"]);
  spawnManagedProcess("reviewer", "node", ["scripts/run-local-service.mjs", "reviewer"]);
  spawnManagedProcess("admin", "node", ["scripts/run-local-service.mjs", "admin"]);

  process.stdout.write("[stack] Waiting for local services to become healthy...\n");
  await Promise.all(Object.values(urls).map((url) => waitForHealthy(url)));

  process.stdout.write("[stack] Local services are ready.\n");
  process.stdout.write("[stack] Reviewer: http://127.0.0.1:4173\n");
  process.stdout.write("[stack] Admin:    http://127.0.0.1:4174\n");
  process.stdout.write("[stack] Control:  http://127.0.0.1:4010\n");

  if (smokeMode) {
    process.stdout.write("[stack] Smoke mode complete. Shutting down started services.\n");
    shutdown();
    return;
  }

  if (noDesktopController) {
    process.stdout.write("[stack] Desktop controller start skipped. Press Ctrl+C to stop the stack.\n");
    return;
  }

  process.stdout.write("[stack] Launching the desktop controller...\n");
  spawnManagedProcess(
    "desktop-controller",
    "node",
    ["scripts/run-local-service.mjs", "desktop-controller"],
    selectedManifestId
      ? { ASSESSMENT_MANIFEST_ID: selectedManifestId }
      : {}
  );

  if (selectedManifestId) {
    process.stdout.write(`[stack] Desktop controller manifest override: ${selectedManifestId}\n`);
  }

  process.stdout.write("[stack] Press Ctrl+C in this console to stop all services started by this command.\n");
}

main().catch((error) => {
  process.stderr.write(`[stack] ${error.message}\n`);
  shutdown();
  process.exit(1);
});
