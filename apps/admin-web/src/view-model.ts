import type { SessionDetail } from "@assessment-platform/contracts";

export type RecentSessionRow = {
  id: string;
  manifestLabel: string;
  statusLabel: string;
  status: string;
  hasScoring: string;
  integrityVerdict: string;
  missingStreams: string;
  scoringError: string;
  reviewerUrl: string;
};

export function buildRecentSessionRows(sessions: SessionDetail[], reviewerBaseUrl: string): RecentSessionRow[] {
  return sessions.map((session) => {
    let statusLabel: string;
    if (session.status === "failed") {
      statusLabel = "failed (scoring error)";
    } else if (session.scoring_status === "corrupted") {
      statusLabel = `${session.status} (scoring corrupted)`;
    } else {
      statusLabel = session.status;
    }
    return {
      id: session.id,
      manifestLabel: `${session.manifest_name} (${session.manifest_id})`,
      statusLabel,
      status: session.status,
      hasScoring: session.has_scoring ? "yes" : "no",
      integrityVerdict: session.integrity_verdict ?? "pending",
      missingStreams: session.missing_streams.join(", ") || "None",
      scoringError: session.scoring_error ?? "None",
      reviewerUrl: `${reviewerBaseUrl}?sessionId=${session.id}`
    };
  });
}
