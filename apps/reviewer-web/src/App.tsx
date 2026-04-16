import { useEffect, useMemo, useState } from "react";
import type { LocalRuntimeConfig, SessionDetail, SessionScoringPayload, ReviewerDecision, ReviewerDecisionValue } from "@assessment-platform/contracts";
import {
  loadDecision,
  loadRuntimeConfig,
  loadScoringIfPresent,
  loadSessionDetail,
  loadSessionEvents,
  loadSessions,
  saveDecision,
  type SessionEventsResponse
} from "./api";
import {
  buildArchetypeProbabilityEntries,
  buildCompletenessSummary,
  buildIntegrityFlagLabels,
  buildTimelineEntries,
  eventCount,
  formatReviewerDecision,
  resolvePreferredSessionId,
  topFeatureLabels
} from "./view-model";

const cardStyle: React.CSSProperties = {
  background: "#ffffff",
  borderRadius: 18,
  padding: 20,
  boxShadow: "0 18px 40px rgba(15,23,42,0.08)"
};

function buildDuplicateSafeItems(values: string[]): Array<{ key: string; value: string }> {
  const seen = new Map<string, number>();
  return values.map((value) => {
    const occurrence = (seen.get(value) ?? 0) + 1;
    seen.set(value, occurrence);
    return { key: `${value}__${occurrence}`, value };
  });
}

export function App() {
  const [runtime, setRuntime] = useState<LocalRuntimeConfig | null>(null);
  const [sessions, setSessions] = useState<SessionDetail[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [selectedSession, setSelectedSession] = useState<SessionDetail | null>(null);
  const [scoring, setScoring] = useState<SessionScoringPayload | null>(null);
  const [events, setEvents] = useState<SessionEventsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [decision, setDecision] = useState<ReviewerDecision | null>(null);
  const [decisionSubmitting, setDecisionSubmitting] = useState(false);
  const [decisionError, setDecisionError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const querySessionId = new URLSearchParams(window.location.search).get("sessionId");

    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        const [runtimeConfig, sessionList] = await Promise.all([loadRuntimeConfig(), loadSessions()]);
        if (cancelled) {
          return;
        }

        setRuntime(runtimeConfig);
        setSessions(sessionList);
        setSelectedSessionId(resolvePreferredSessionId(querySessionId, runtimeConfig, sessionList));
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load reviewer data.");
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

  useEffect(() => {
    let cancelled = false;

    const loadSelectedSession = async () => {
      if (!selectedSessionId) {
        setSelectedSession(null);
        setScoring(null);
        setEvents(null);
        return;
      }

      try {
        setSessionLoading(true);
        setError(null);
        const [sessionDetail, sessionEvents, scoringPayload, existingDecision] = await Promise.all([
          loadSessionDetail(selectedSessionId),
          loadSessionEvents(selectedSessionId),
          loadScoringIfPresent(selectedSessionId),
          loadDecision(selectedSessionId)
        ]);
        if (cancelled) {
          return;
        }

        setSelectedSession(sessionDetail);
        setEvents(sessionEvents);
        setScoring(scoringPayload);
        setDecision(existingDecision);
        setDecisionError(null);
        setSessions((currentSessions) =>
          currentSessions.map((session) => (session.id === sessionDetail.id ? sessionDetail : session))
        );

        const nextUrl = new URL(window.location.href);
        nextUrl.searchParams.set("sessionId", selectedSessionId);
        window.history.replaceState({}, "", nextUrl);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load the selected session.");
        }
      } finally {
        if (!cancelled) {
          setSessionLoading(false);
        }
      }
    };

    void loadSelectedSession();

    return () => {
      cancelled = true;
    };
  }, [selectedSessionId]);

  const timeline = useMemo(() => buildTimelineEntries(events), [events]);
  const features = useMemo(() => topFeatureLabels(scoring), [scoring]);
  const archetypeProbabilities = useMemo(() => buildArchetypeProbabilityEntries(scoring), [scoring]);
  const integrityFlags = useMemo(() => buildIntegrityFlagLabels(scoring), [scoring]);
  const integrityFlagItems = useMemo(() => buildDuplicateSafeItems(integrityFlags), [integrityFlags]);
  const integrityNoteItems = useMemo(
    () => buildDuplicateSafeItems(scoring?.integrity.notes ?? []),
    [scoring]
  );
  const totalEvents = useMemo(
    () => eventCount(events) || Object.values(selectedSession?.event_counts_by_source ?? {}).reduce((sum, count) => sum + count, 0),
    [events, selectedSession]
  );
  const completeness = useMemo(() => buildCompletenessSummary(selectedSession), [selectedSession]);

  const integrityVerdict = scoring?.integrity.verdict ?? selectedSession?.integrity_verdict ?? "pending";
  const policyRecommendation = scoring?.policy_recommendation ?? selectedSession?.policy_recommendation ?? "pending";

  const handleDecision = async (value: ReviewerDecisionValue) => {
    if (!selectedSessionId || decisionSubmitting) {
      return;
    }
    setDecisionSubmitting(true);
    setDecisionError(null);
    try {
      const saved = await saveDecision(selectedSessionId, value);
      setDecision(saved);
    } catch (err) {
      setDecisionError(err instanceof Error ? err.message : "Failed to save decision.");
    } finally {
      setDecisionSubmitting(false);
    }
  };

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "linear-gradient(160deg, #e0f2fe 0%, #f8fafc 48%, #fef3c7 100%)",
        color: "#0f172a",
        fontFamily: "'Segoe UI', sans-serif",
        padding: 24
      }}
    >
      <div style={{ maxWidth: 1200, margin: "0 auto", display: "grid", gap: 20 }}>
        <header>
          <p style={{ textTransform: "uppercase", letterSpacing: 2, fontSize: 12, marginBottom: 8 }}>Reviewer Console</p>
          <h1 style={{ margin: 0, fontSize: 40 }}>Session Evidence and Decision Workspace</h1>
          <p style={{ maxWidth: 760 }}>
            This view now reads real local session data from the control plane. It defaults to the latest scored session or a
            `sessionId` query parameter.
          </p>
        </header>

        {loading ? <StatusCard title="Loading" body="Fetching runtime, sessions, scoring, and event timeline." /> : null}
        {!loading && error ? <StatusCard title="Error" body={error} /> : null}
        {!loading && !error && !sessions.length ? (
          <StatusCard title="No Sessions Yet" body="Start or score a session through the local control plane, then refresh." />
        ) : null}

        {!loading && sessions.length ? (
          <section style={cardStyle}>
            <label style={{ display: "grid", gap: 8, maxWidth: 560 }}>
              <span style={{ fontWeight: 700 }}>Session Selector</span>
              <select
                value={selectedSessionId ?? ""}
                onChange={(event) => setSelectedSessionId(event.target.value || null)}
                style={{ padding: 12, borderRadius: 12, border: "1px solid #cbd5e1" }}
              >
                {sessions.map((session) => (
                  <option key={session.id} value={session.id}>
                    {`${session.status.toUpperCase()} | ${session.manifest_name} | ${session.id}`}
                  </option>
                ))}
              </select>
            </label>
          </section>
        ) : null}

        {!loading && !error && selectedSession && !sessionLoading ? (
          <>
            <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 16 }}>
              <div style={cardStyle}>
                <h2>HACI</h2>
                <p style={{ fontSize: 42, margin: "8px 0" }}>{scoring?.haci_score ?? "--"}</p>
                <p style={{ margin: 0 }}>Band: {scoring?.haci_band ?? "pending"}</p>
              </div>
              <div style={cardStyle}>
                <h2>Predicted Archetype</h2>
                <p style={{ fontSize: 28, margin: "8px 0" }}>{scoring?.predicted_archetype ?? "Not scored yet"}</p>
                <p style={{ margin: 0 }}>Confidence: {scoring?.confidence ?? "pending"}</p>
              </div>
              <div style={cardStyle}>
                <h2>Integrity Verdict</h2>
                <p style={{ fontSize: 28, margin: "8px 0" }}>{integrityVerdict}</p>
                <p style={{ margin: 0 }}>Policy Recommendation: {policyRecommendation}</p>
              </div>
              <div style={cardStyle}>
                <h2>Scoring Provenance</h2>
                <p style={{ margin: "0 0 8px" }}>Mode: {scoring?.scoring_mode ?? "pending"}</p>
                <p style={{ margin: "0 0 8px" }}>Model: {scoring?.model_version ?? "pending"}</p>
                <p style={{ margin: "0 0 8px" }}>Archetype certainty:</p>
                {archetypeProbabilities.length ? (
                  <ul style={{ paddingLeft: 18, margin: 0 }}>
                    {archetypeProbabilities.map((item) => (
                      <li key={item.name}>
                        {item.name}: {(item.probability * 100).toFixed(1)}%
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p style={{ margin: 0 }}>No archetype probability distribution available.</p>
                )}
              </div>
            </section>

            <section style={cardStyle}>
              <h2>Reviewer Decision</h2>
              {decision ? (
                <p style={{ margin: "0 0 12px" }}>
                  Current decision: <strong>{formatReviewerDecision(decision.decision)}</strong>
                  {" "}(recorded {new Date(decision.decided_at).toLocaleString()})
                </p>
              ) : (
                <p style={{ margin: "0 0 12px" }}>No decision recorded yet.</p>
              )}
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {(
                  [
                    { value: "approve", label: "Approve", background: "#16a34a" },
                    { value: "reject", label: "Reject", background: "#dc2626" },
                    { value: "needs_followup", label: "Needs Follow-up", background: "#d97706" }
                  ] as const
                ).map(({ value, label, background }) => (
                  <button
                    key={value}
                    disabled={decisionSubmitting}
                    onClick={() => void handleDecision(value)}
                    style={{ padding: "8px 20px", borderRadius: 10, border: "none", background, color: "#fff", fontWeight: 700, cursor: decisionSubmitting ? "not-allowed" : "pointer" }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {decisionError ? <p style={{ margin: "8px 0 0", color: "#dc2626" }}>{decisionError}</p> : null}
            </section>

            <section style={{ display: "grid", gridTemplateColumns: "1.2fr 0.8fr", gap: 16 }}>
              <div style={cardStyle}>
                <h2>Timeline</h2>
                {timeline.length ? (
                  <ul style={{ paddingLeft: 18, margin: 0 }}>
                    {timeline.map((entry) => (
                      <li key={`${entry.timestampLabel}-${entry.label}`}>
                        {entry.timestampLabel} {entry.label}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p style={{ margin: 0 }}>No event timeline available for this session.</p>
                )}
              </div>
              <div style={cardStyle}>
                <h2>Top Feature Drivers</h2>
                {features.length ? (
                  <ul style={{ paddingLeft: 18, margin: 0 }}>
                    {features.map((feature) => (
                      <li key={feature}>{feature}</li>
                    ))}
                  </ul>
                ) : (
                  <p style={{ margin: 0 }}>No scoring features are available for this session yet.</p>
                )}
              </div>
            </section>

            <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
              <div style={cardStyle}>
                <h2>Completeness</h2>
                <p style={{ margin: "0 0 8px" }}>Required streams: {completeness.requiredStreams.join(", ") || "None"}</p>
                <p style={{ margin: "0 0 8px" }}>Present streams: {completeness.presentStreams.join(", ") || "None"}</p>
                <p style={{ margin: "0 0 8px" }}>Missing streams: {completeness.missingStreams.join(", ") || "None"}</p>
                <p style={{ margin: "0 0 8px" }}>
                  Invalidation reasons: {completeness.invalidationReasons.join(", ") || "None"}
                </p>
                <p style={{ margin: 0 }}>
                  Source counts:{" "}
                  {completeness.sourceCounts.length
                    ? completeness.sourceCounts.map((item) => `${item.source} (${item.count})`).join(", ")
                    : "None"}
                </p>
              </div>
              <div style={cardStyle}>
                <h2>Session Details</h2>
                <p style={{ margin: "0 0 8px" }}>Session ID: {selectedSession.id}</p>
                <p style={{ margin: "0 0 8px" }}>Candidate: {selectedSession.candidate_id}</p>
                <p style={{ margin: "0 0 8px" }}>Status: {selectedSession.status}</p>
                <p style={{ margin: "0 0 8px" }}>First Event: {selectedSession.first_event_at ?? "None"}</p>
                <p style={{ margin: 0 }}>Last Event: {selectedSession.last_event_at ?? "None"}</p>
              </div>
              <div style={cardStyle}>
                <h2>Runtime</h2>
                <p style={{ margin: "0 0 8px" }}>Control Plane: {runtime?.control_plane_url ?? "Unavailable"}</p>
                <p style={{ margin: "0 0 8px" }}>Ingestion: {runtime?.ingestion_url ?? "Unavailable"}</p>
                <p style={{ margin: "0 0 8px" }}>Latest Scored Session: {runtime?.latest_scored_session_id ?? "None"}</p>
                <p style={{ margin: "0 0 8px" }}>Event Count: {totalEvents}</p>
                <p style={{ margin: 0 }}>
                  Source Mix:{" "}
                  {completeness.sourceCounts.length
                    ? completeness.sourceCounts.map((item) => `${item.source} (${item.count})`).join(", ")
                    : "None"}
                </p>
              </div>
              <div style={cardStyle}>
                <h2>Integrity Flags</h2>
                {!scoring ? (
                  <p style={{ margin: "0 0 8px" }}>Score this session to view integrity detail.</p>
                ) : integrityFlags.length ? (
                  <>
                    <ul style={{ paddingLeft: 18, margin: "0 0 8px" }}>
                      {integrityFlagItems.map((item) => (
                        <li key={item.key}>{item.value}</li>
                      ))}
                    </ul>
                    <p style={{ margin: "0 0 8px" }}>Notes:</p>
                    {integrityNoteItems.length ? (
                      <ul style={{ paddingLeft: 18, margin: 0 }}>
                        {integrityNoteItems.map((item) => (
                          <li key={item.key}>{item.value}</li>
                        ))}
                      </ul>
                    ) : (
                      <p style={{ margin: 0 }}>None</p>
                    )}
                  </>
                ) : (
                  <p style={{ margin: 0 }}>No integrity flags.</p>
                )}
              </div>
            </section>
          </>
        ) : null}

        {!loading && selectedSessionId && sessionLoading ? (
          <StatusCard title="Loading Session" body="Fetching the selected session detail, scoring payload, and event timeline." />
        ) : null}
      </div>
    </main>
  );
}

function StatusCard({ title, body }: { title: string; body: string }) {
  return (
    <section style={cardStyle}>
      <h2>{title}</h2>
      <p style={{ margin: 0 }}>{body}</p>
    </section>
  );
}
