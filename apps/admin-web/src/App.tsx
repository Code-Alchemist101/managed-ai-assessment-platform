import { useEffect, useMemo, useState } from "react";
import type { LocalRuntimeConfig, SessionDetail } from "@assessment-platform/contracts";
import { loadManifests, loadRuntimeConfig, loadSessions, type AdminManifest } from "./api";
import { buildRecentSessionRows } from "./view-model";

const panelStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.9)",
  backdropFilter: "blur(10px)",
  borderRadius: 20,
  padding: 20,
  boxShadow: "0 18px 42px rgba(120,53,15,0.12)"
};

export function App() {
  const [runtime, setRuntime] = useState<LocalRuntimeConfig | null>(null);
  const [manifests, setManifests] = useState<AdminManifest[]>([]);
  const [sessions, setSessions] = useState<SessionDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        const [runtimeConfig, manifestList, sessionList] = await Promise.all([
          loadRuntimeConfig(),
          loadManifests(),
          loadSessions()
        ]);
        if (cancelled) {
          return;
        }
        setRuntime(runtimeConfig);
        setManifests(manifestList);
        setSessions(sessionList);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load admin data.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  const scoredSessions = useMemo(() => sessions.filter((session) => session.status === "scored").length, [sessions]);
  const invalidSessions = useMemo(() => sessions.filter((session) => session.status === "invalid").length, [sessions]);
  const recentSessionRows = useMemo(
    () => buildRecentSessionRows(sessions, runtime?.reviewer_url ?? "http://127.0.0.1:4173"),
    [runtime?.reviewer_url, sessions]
  );

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "radial-gradient(circle at top left, #fb923c 0%, #fff7ed 34%, #ecfeff 100%)",
        color: "#1f2937",
        fontFamily: "'Segoe UI', sans-serif",
        padding: 24
      }}
    >
      <div style={{ maxWidth: 1280, margin: "0 auto", display: "grid", gap: 18 }}>
        <header>
          <p style={{ textTransform: "uppercase", letterSpacing: 2, fontSize: 12, marginBottom: 8 }}>Admin Console</p>
          <h1 style={{ margin: 0, fontSize: 40 }}>Assessment Configuration</h1>
          <p style={{ maxWidth: 720 }}>
            This view is now backed by the local control plane for manifest visibility, session inventory, and reviewer triage links.
          </p>
        </header>

        {loading ? <StatusPanel title="Loading" body="Fetching manifests, runtime config, and session summaries." /> : null}
        {!loading && error ? <StatusPanel title="Error" body={error} /> : null}

        {!loading && !error ? (
          <>
            <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
              <div style={panelStyle}>
                <h2>Live Local Runtime</h2>
                <p>Total sessions: {sessions.length}</p>
                <p>Scored sessions: {scoredSessions}</p>
                <p>Invalid sessions: {invalidSessions}</p>
                <p>Latest scored session: {runtime?.latest_scored_session_id ?? "None"}</p>
              </div>
              <div style={panelStyle}>
                <h2>Active Services</h2>
                <p style={{ margin: "0 0 6px", fontSize: 13, color: "#6b7280" }}>Live endpoint configuration from runtime.</p>
                <ul style={{ paddingLeft: 18, margin: 0, fontSize: 13 }}>
                  <li>Control plane: {runtime?.control_plane_url ?? "—"}</li>
                  <li>Analytics: {runtime?.analytics_url ?? "—"}</li>
                  <li>Ingestion: {runtime?.ingestion_url ?? "—"}</li>
                  <li>Reviewer: {runtime?.reviewer_url ?? "—"}</li>
                </ul>
              </div>
            </section>

            <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
              {manifests.map((manifest) => (
                <div key={manifest.id} style={panelStyle}>
                  <h2 style={{ marginTop: 0 }}>{manifest.name}</h2>
                  <p style={{ margin: "0 0 8px" }}>Manifest ID: {manifest.id}</p>
                  <p style={{ margin: "0 0 8px" }}>Language: {manifest.language}</p>
                  <p style={{ margin: "0 0 8px" }}>Required streams: {manifest.required_streams.join(", ")}</p>
                  <p style={{ margin: "0 0 8px" }}>
                    Providers: {manifest.allowed_ai_providers.join(", ") || "None"}
                  </p>
                  <p style={{ margin: "0 0 8px" }}>Allowed sites: {manifest.allowed_sites.length}</p>
                  <p style={{ margin: 0 }}>
                    Policy: auto-advance {manifest.decision_policy.auto_advance_min_confidence.toFixed(2)}, full completeness{" "}
                    {manifest.decision_policy.require_full_completeness ? "required" : "optional"}
                  </p>
                </div>
              ))}
            </section>

            <section style={panelStyle}>
              <h2 style={{ marginTop: 0 }}>Recent Sessions</h2>
              {recentSessionRows.length ? (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr>
                        <HeaderCell label="Session ID" />
                        <HeaderCell label="Manifest" />
                        <HeaderCell label="Status" />
                        <HeaderCell label="Scoring Error" />
                        <HeaderCell label="Has Scoring" />
                        <HeaderCell label="Integrity Verdict" />
                        <HeaderCell label="Missing Streams" />
                        <HeaderCell label="Reviewer" />
                      </tr>
                    </thead>
                    <tbody>
                      {recentSessionRows.map((row) => (
                        <tr key={row.id}>
                          <BodyCell value={row.id} />
                          <BodyCell value={row.manifestLabel} />
                          <BodyCell value={row.statusLabel} />
                          <BodyCell value={row.scoringError} />
                          <BodyCell value={row.hasScoring} />
                          <BodyCell value={row.integrityVerdict} />
                          <BodyCell value={row.missingStreams} />
                          <td style={{ padding: "12px 10px", borderTop: "1px solid #e5e7eb" }}>
                            <a href={row.reviewerUrl} style={{ color: "#1d4ed8" }}>
                              Open Reviewer
                            </a>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p style={{ margin: 0 }}>No sessions are available yet.</p>
              )}
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}

function HeaderCell({ label }: { label: string }) {
  return (
    <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #d1d5db", fontWeight: 700 }}>
      {label}
    </th>
  );
}

function BodyCell({ value }: { value: string }) {
  return <td style={{ padding: "12px 10px", borderTop: "1px solid #e5e7eb" }}>{value}</td>;
}

function StatusPanel({ title, body }: { title: string; body: string }) {
  return (
    <section style={panelStyle}>
      <h2>{title}</h2>
      <p style={{ margin: 0 }}>{body}</p>
    </section>
  );
}
