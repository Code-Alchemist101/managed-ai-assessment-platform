import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const runtimeRoot = path.join(repoRoot, ".runtime-data", "local-dev");
const sessionsPath = path.join(runtimeRoot, "control-plane", "sessions.json");
const scoringDir = path.join(runtimeRoot, "control-plane", "scorings");
const ingestionDir = path.join(runtimeRoot, "ingestion", "sessions");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function fileExists(filePath) {
  return fs.existsSync(filePath);
}

function loadSessions() {
  if (!fileExists(sessionsPath)) {
    throw new Error(`Missing session inventory: ${sessionsPath}`);
  }

  const sessions = readJson(sessionsPath);
  if (!Array.isArray(sessions)) {
    throw new Error(`Unexpected session inventory format in ${sessionsPath}`);
  }

  return sessions;
}

function parseArgs(argv) {
  const options = {
    sessionId: null,
    latest: false,
    json: false
  };

  for (const arg of argv) {
    if (arg === "--latest") {
      options.latest = true;
      continue;
    }

    if (arg === "--json") {
      options.json = true;
      continue;
    }

    if (!arg.startsWith("--") && !options.sessionId) {
      options.sessionId = arg;
    }
  }

  return options;
}

function resolveTargetSession(sessions, sessionIdArg) {
  if (sessionIdArg) {
    const session = sessions.find((entry) => entry.id === sessionIdArg);
    if (!session) {
      throw new Error(`Session ${sessionIdArg} not found in ${sessionsPath}`);
    }

    return session;
  }

  return resolveLatestSession(sessions);
}

function resolveLatestSession(sessions) {
  const latest = [...sessions]
    .sort((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at))
    .find((entry) => entry.has_scoring || fileExists(path.join(scoringDir, `${entry.id}.json`)));

  if (!latest) {
    throw new Error("No scored sessions were found in the local runtime data.");
  }

  return latest;
}

function buildSummary(target, scoringPath, scoring, eventsPath, events) {
  const countsBySource = groupCounts(events, (event) => event.source || "unknown");
  const unsupportedSites = collectUnsupportedSites(events);
  const aiEventCounts = collectAiEventCounts(events);
  const sequenceAnomalies = collectSequenceAnomalies(events);
  const firstEventAt = events[0]?.timestamp_utc ?? "n/a";
  const lastEventAt = events[events.length - 1]?.timestamp_utc ?? "n/a";
  const integrity = scoring?.integrity ?? {};

  return {
    session: {
      id: target.id,
      manifest_id: target.manifest_id,
      candidate_id: target.candidate_id,
      status: target.status,
      created_at: target.created_at,
      updated_at: target.updated_at
    },
    files: {
      session_inventory: sessionsPath,
      raw_events: eventsPath,
      scoring: scoring ? scoringPath : null
    },
    scoring: {
      haci_score: scoring?.haci_score ?? null,
      haci_band: scoring?.haci_band ?? null,
      predicted_archetype: scoring?.predicted_archetype ?? null,
      confidence: scoring?.confidence ?? null,
      policy_recommendation: scoring?.policy_recommendation ?? null,
      top_features: scoring?.top_features ?? [],
      integrity: {
        verdict: integrity.verdict ?? null,
        flags: integrity.flags ?? [],
        notes: integrity.notes ?? [],
        required_streams_present: integrity.required_streams_present ?? [],
        missing_streams: integrity.missing_streams ?? []
      }
    },
    events: {
      count: events.length,
      first_event_at: firstEventAt,
      last_event_at: lastEventAt,
      source_mix: countsBySource,
      ai_event_counts: aiEventCounts,
      unsupported_browser_sites: unsupportedSites,
      sequence_anomalies: sequenceAnomalies
    }
  };
}

function printHumanSummary(summary) {
  const { session, files, scoring, events } = summary;
  const integrity = scoring.integrity;

  console.log("Assessment Platform Session Report");
  console.log("==================================");
  console.log(`Session ID: ${session.id}`);
  console.log(`Manifest: ${session.manifest_id}`);
  console.log(`Candidate: ${session.candidate_id}`);
  console.log(`Status: ${session.status}`);
  console.log(`Created: ${session.created_at}`);
  console.log(`Updated: ${session.updated_at}`);
  console.log("");
  console.log("Files");
  console.log(`- Session inventory: ${files.session_inventory}`);
  console.log(`- Raw events: ${files.raw_events}`);
  console.log(`- Scoring: ${files.scoring ?? "not found"}`);
  console.log("");
  console.log("Scoring");
  console.log(`- HACI: ${scoring.haci_score ?? "n/a"} (${scoring.haci_band ?? "n/a"})`);
  console.log(`- Archetype: ${scoring.predicted_archetype ?? "n/a"} (confidence ${scoring.confidence ?? "n/a"})`);
  console.log(`- Integrity verdict: ${integrity.verdict ?? "n/a"}`);
  console.log(`- Policy recommendation: ${scoring.policy_recommendation ?? "n/a"}`);
  console.log(`- Integrity flags: ${formatList(integrity.flags)}`);
  console.log(`- Integrity notes: ${formatList(integrity.notes)}`);
  console.log(`- Required streams present: ${formatList(integrity.required_streams_present)}`);
  console.log(`- Missing streams: ${formatList(integrity.missing_streams)}`);
  console.log(
    `- Top features: ${
      scoring.top_features.length > 0
        ? scoring.top_features.map((feature) => `${feature.name} (${feature.contribution})`).join(", ")
        : "none"
    }`
  );
  console.log("");
  console.log("Event Summary");
  console.log(`- Event count: ${events.count}`);
  console.log(`- First event: ${events.first_event_at}`);
  console.log(`- Last event: ${events.last_event_at}`);
  console.log(`- Source mix: ${formatCounts(events.source_mix)}`);
  console.log(`- AI event counts: ${formatCounts(events.ai_event_counts)}`);
  console.log(`- Unsupported browser sites: ${formatList(events.unsupported_browser_sites)}`);
  console.log("- Sequence anomalies:");
  for (const line of formatSequenceSummary(events.sequence_anomalies)) {
    console.log(`  - ${line}`);
  }
  console.log("");
  console.log("Tip");
  console.log(`- Run \`npm run session:report -- ${session.id}\` again any time you need the same summary.`);
}

function loadEvents(sessionId) {
  const eventsPath = path.join(ingestionDir, `${sessionId}.ndjson`);
  if (!fileExists(eventsPath)) {
    return { eventsPath, events: [] };
  }

  const raw = fs.readFileSync(eventsPath, "utf8");
  const events = raw
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  return { eventsPath, events };
}

function groupCounts(items, selector) {
  return items.reduce((accumulator, item) => {
    const key = selector(item);
    accumulator[key] = (accumulator[key] ?? 0) + 1;
    return accumulator;
  }, {});
}

function formatCounts(counts) {
  const entries = Object.entries(counts);
  if (entries.length === 0) {
    return "none";
  }

  return entries
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([key, value]) => `${key} (${value})`)
    .join(", ");
}

function collectUnsupportedSites(events) {
  const domains = new Set();
  for (const event of events) {
    if (event.event_type !== "browser.navigation") {
      continue;
    }

    const payload = event.payload ?? {};
    const domain = payload.domain || payload.url || "unknown";
    const isLocalBootstrap =
      domain === "127.0.0.1" ||
      domain === "localhost" ||
      domain === "newtab" ||
      String(payload.url || "").startsWith("edge://");

    if ((payload.allowed_site === false || payload.policy_flag) && !isLocalBootstrap) {
      domains.add(domain);
    }
  }

  return [...domains].sort();
}

function collectAiEventCounts(events) {
  const aiEvents = events.filter(
    (event) =>
      typeof event.event_type === "string" &&
      (event.event_type.startsWith("browser.ai.") || event.event_type.startsWith("ide.ai."))
  );

  return groupCounts(aiEvents, (event) => event.event_type);
}

function collectSequenceAnomalies(events) {
  const bySource = new Map();
  for (const event of events) {
    const source = event.source || "unknown";
    const sequence = Number(event.sequence_no);
    if (!Number.isFinite(sequence)) {
      continue;
    }

    if (!bySource.has(source)) {
      bySource.set(source, []);
    }
    bySource.get(source).push({
      sequence,
      eventType: event.event_type || "unknown",
      timestamp: event.timestamp_utc || "unknown"
    });
  }

  const anomalies = {};
  for (const [source, sourceEvents] of bySource.entries()) {
    const sourceAnomalies = [];
    let previous = null;

    for (const item of sourceEvents) {
      if (previous === null) {
        previous = item;
        continue;
      }

      if (item.sequence === previous.sequence + 1) {
        previous = item;
        continue;
      }

      let kind = "jump";
      if (item.sequence === previous.sequence) {
        kind = "duplicate";
      } else if (item.sequence < previous.sequence) {
        kind = "reset";
      }

      sourceAnomalies.push({
        kind,
        expected: previous.sequence + 1,
        actual: item.sequence,
        eventType: item.eventType,
        timestamp: item.timestamp
      });
      previous = item;
    }

    if (sourceAnomalies.length > 0) {
      anomalies[source] = sourceAnomalies;
    }
  }

  return anomalies;
}

function formatSequenceSummary(anomalies) {
  const sources = Object.entries(anomalies);
  if (sources.length === 0) {
    return ["none"];
  }

  return sources.map(([source, items]) => {
    const example = items[0];
    return `${source}: ${items.length} anomaly(s), first ${example.kind} expected ${example.expected} saw ${example.actual} at ${example.timestamp}`;
  });
}

function formatTopFeatures(scoring) {
  const features = scoring?.top_features ?? [];
  if (features.length === 0) {
    return "none";
  }

  return features
    .map((feature) => `${feature.name} (${feature.contribution})`)
    .join(", ");
}

function formatList(values) {
  return values.length > 0 ? values.join(", ") : "none";
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const sessions = loadSessions();
  const target = resolveTargetSession(sessions, options.latest ? null : options.sessionId);
  const scoringPath = path.join(scoringDir, `${target.id}.json`);
  const scoring = fileExists(scoringPath) ? readJson(scoringPath) : null;
  const { eventsPath, events } = loadEvents(target.id);
  const summary = buildSummary(target, scoringPath, scoring, eventsPath, events);

  if (options.json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  printHumanSummary(summary);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
