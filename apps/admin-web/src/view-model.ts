import type { SessionDetail } from "@assessment-platform/contracts";

export type RecentSessionRow = {
  id: string;
  manifestLabel: string;
  status: string;
  hasScoring: string;
  integrityVerdict: string;
  missingStreams: string;
  reviewerUrl: string;
};

export function buildRecentSessionRows(sessions: SessionDetail[], reviewerBaseUrl: string): RecentSessionRow[] {
  return sessions.map((session) => ({
    id: session.id,
    manifestLabel: `${session.manifest_name} (${session.manifest_id})`,
    status: session.status,
    hasScoring: session.has_scoring ? "yes" : "no",
    integrityVerdict: session.integrity_verdict ?? "pending",
    missingStreams: session.missing_streams.join(", ") || "None",
    reviewerUrl: `${reviewerBaseUrl}?sessionId=${session.id}`
  }));
}
