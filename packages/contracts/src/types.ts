import { z } from "zod";
import signalCatalogData from "./signal-catalog.json";

export const signalCatalog = signalCatalogData;
export const signalNames = signalCatalog.map((signal) => signal.name) as unknown as [string, ...string[]];

export const archetypes = [
  "Independent Solver",
  "Structured Collaborator",
  "Prompt Engineer Solver",
  "Iterative Debugger",
  "AI-Dependent Constructor",
  "Blind Copier",
  "Exploratory Learner"
] as const;

export const ArchetypeSchema = z.enum(archetypes);
export const SignalNameSchema = z.enum(signalNames);
export const SignalClassificationSchema = z.enum(["direct", "derived", "controlled-only", "inferred"]);
export const CompletenessStateSchema = z.enum(["complete", "partial", "missing"]);
export const EventSourceSchema = z.enum(["desktop", "ide", "browser", "ai", "system"]);
export const PolicyRecommendationSchema = z.enum(["auto-advance", "human-review", "invalid-session"]);

export const SessionManifestSchema = z.object({
  id: z.string(),
  name: z.string(),
  task_prompt: z.string(),
  language: z.string(),
  allowed_ai_providers: z.array(z.string()),
  allowed_sites: z.array(z.string()),
  required_streams: z.array(z.string()),
  evidence_settings: z.object({
    screenshots_enabled: z.boolean().default(false),
    screen_recording_metadata_only: z.boolean().default(true)
  }),
  decision_policy: z.object({
    auto_advance_min_confidence: z.number().min(0).max(1).default(0.9),
    auto_reject_enabled: z.boolean().default(false),
    require_full_completeness: z.boolean().default(true)
  })
});

export const EventEnvelopeSchema = z.object({
  event_id: z.string(),
  session_id: z.string(),
  timestamp_utc: z.string().datetime(),
  source: EventSourceSchema,
  event_type: z.string().min(1),
  sequence_no: z.number().int().nonnegative(),
  artifact_ref: z.string(),
  payload: z.record(z.string(), z.unknown()),
  client_version: z.string(),
  integrity_hash: z.string(),
  policy_context: z.record(z.string(), z.unknown()).default({})
});

export const FeatureSignalSchema = z.object({
  name: SignalNameSchema,
  category: z.string(),
  classification: SignalClassificationSchema,
  value: z.number(),
  completeness: CompletenessStateSchema,
  provenance: z.array(z.string()),
  description: z.string()
});

export const FeatureVectorSchema = z.object({
  session_id: z.string(),
  extraction_version: z.string(),
  generated_at: z.string().datetime(),
  signal_values: z.record(z.string(), z.number()),
  signals: z.array(FeatureSignalSchema),
  completeness: CompletenessStateSchema,
  invalidation_reasons: z.array(z.string()).default([])
});

export const IntegrityResultSchema = z.object({
  verdict: z.enum(["clean", "review", "invalid"]),
  flags: z.array(z.string()),
  required_streams_present: z.array(z.string()),
  missing_streams: z.array(z.string()),
  notes: z.array(z.string())
});

export const SessionStatusSchema = z.enum(["created", "active", "submitted", "scored", "invalid"]);

export const SessionSummarySchema = z.object({
  id: z.string(),
  manifest_id: z.string(),
  candidate_id: z.string(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  status: SessionStatusSchema,
  has_scoring: z.boolean().default(false)
});

export const SessionEventCountsSchema = z.record(z.string(), z.number().int().nonnegative());

export const SessionDetailSchema = SessionSummarySchema.extend({
  manifest_name: z.string(),
  required_streams: z.array(z.string()),
  present_streams: z.array(z.string()),
  event_counts_by_source: SessionEventCountsSchema.default({}),
  first_event_at: z.string().datetime().nullable(),
  last_event_at: z.string().datetime().nullable(),
  integrity_verdict: IntegrityResultSchema.shape.verdict.nullable(),
  missing_streams: z.array(z.string()).default([]),
  policy_recommendation: PolicyRecommendationSchema.nullable(),
  invalidation_reasons: z.array(z.string()).default([]),
  haci_score: z.number().min(0).max(100).nullable(),
  predicted_archetype: ArchetypeSchema.nullable()
});

export const ScoringResultSchema = z.object({
  session_id: z.string(),
  model_version: z.string(),
  scoring_mode: z.enum(["heuristic", "trained_model"]),
  haci_score: z.number().min(0).max(100),
  haci_band: z.enum(["high", "medium", "low"]),
  predicted_archetype: ArchetypeSchema,
  archetype_probabilities: z.record(z.string(), z.number()),
  confidence: z.number().min(0).max(1),
  top_features: z.array(
    z.object({
      name: SignalNameSchema,
      contribution: z.number()
    })
  ),
  integrity: IntegrityResultSchema,
  policy_recommendation: PolicyRecommendationSchema,
  review_required: z.boolean(),
  heuristic_result: z
    .object({
      scoring_mode: z.literal("heuristic"),
      model_version: z.string(),
      predicted_archetype: ArchetypeSchema,
      archetype_probabilities: z.record(z.string(), z.number()),
      confidence: z.number().min(0).max(1)
    })
    .optional(),
  trained_model_result: z
    .object({
      scoring_mode: z.literal("trained_model"),
      model_version: z.string(),
      predicted_archetype: ArchetypeSchema,
      archetype_probabilities: z.record(z.string(), z.number()),
      confidence: z.number().min(0).max(1)
    })
    .nullable()
    .optional()
});

export const SessionScoringPayloadSchema = ScoringResultSchema.extend({
  feature_vector: FeatureVectorSchema
});

export const SessionBootstrapSchema = z.object({
  session_id: z.string(),
  manifest_id: z.string(),
  control_plane_url: z.string().url(),
  ingestion_event_endpoint: z.string().url(),
  reviewer_url: z.string().url(),
  allowed_ai_providers: z.array(z.string()),
  allowed_sites: z.array(z.string()),
  required_streams: z.array(z.string())
});

export const LocalRuntimeConfigSchema = z.object({
  control_plane_url: z.string().url(),
  ingestion_url: z.string().url(),
  analytics_url: z.string().url(),
  reviewer_url: z.string().url(),
  admin_url: z.string().url(),
  assessment_data_dir: z.string(),
  latest_session_id: z.string().nullable(),
  latest_scored_session_id: z.string().nullable()
});

export const ReviewerDecisionValueSchema = z.enum(["approve", "reject", "needs_followup"]);

export const ReviewerDecisionSchema = z.object({
  session_id: z.string(),
  decision: ReviewerDecisionValueSchema,
  note: z.string().optional(),
  decided_at: z.string().datetime()
});

export const haciWeights = {
  typing_vs_paste_ratio: 0.25,
  prompt_refinement_count: 0.25,
  time_to_first_ai_prompt: 0.15,
  ai_output_edit_distance: 0.15,
  max_paste_length: -0.2
} as const;

export const haciBounds = {
  typing_vs_paste_ratio: [0, 5],
  prompt_refinement_count: [0, 15],
  time_to_first_ai_prompt: [0, 1800],
  ai_output_edit_distance: [0, 500],
  max_paste_length: [0, 2000]
} as const;

export type SessionManifest = z.infer<typeof SessionManifestSchema>;
export type EventEnvelope = z.infer<typeof EventEnvelopeSchema>;
export type FeatureSignal = z.infer<typeof FeatureSignalSchema>;
export type FeatureVector = z.infer<typeof FeatureVectorSchema>;
export type IntegrityResult = z.infer<typeof IntegrityResultSchema>;
export type ScoringResult = z.infer<typeof ScoringResultSchema>;
export type SessionSummary = z.infer<typeof SessionSummarySchema>;
export type SessionDetail = z.infer<typeof SessionDetailSchema>;
export type SessionScoringPayload = z.infer<typeof SessionScoringPayloadSchema>;
export type SessionBootstrap = z.infer<typeof SessionBootstrapSchema>;
export type LocalRuntimeConfig = z.infer<typeof LocalRuntimeConfigSchema>;
export type ReviewerDecisionValue = z.infer<typeof ReviewerDecisionValueSchema>;
export type ReviewerDecision = z.infer<typeof ReviewerDecisionSchema>;
