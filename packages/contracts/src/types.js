"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.haciBounds = exports.haciWeights = exports.ScoringResultSchema = exports.IntegrityResultSchema = exports.FeatureVectorSchema = exports.FeatureSignalSchema = exports.EventEnvelopeSchema = exports.SessionManifestSchema = exports.EventSourceSchema = exports.CompletenessStateSchema = exports.SignalClassificationSchema = exports.SignalNameSchema = exports.ArchetypeSchema = exports.archetypes = exports.signalNames = exports.signalCatalog = void 0;
const zod_1 = require("zod");
const signal_catalog_json_1 = __importDefault(require("./signal-catalog.json"));
exports.signalCatalog = signal_catalog_json_1.default;
exports.signalNames = exports.signalCatalog.map((signal) => signal.name);
exports.archetypes = [
    "Independent Solver",
    "Structured Collaborator",
    "Prompt Engineer Solver",
    "Iterative Debugger",
    "AI-Dependent Constructor",
    "Blind Copier",
    "Exploratory Learner"
];
exports.ArchetypeSchema = zod_1.z.enum(exports.archetypes);
exports.SignalNameSchema = zod_1.z.enum(exports.signalNames);
exports.SignalClassificationSchema = zod_1.z.enum(["direct", "derived", "controlled-only", "inferred"]);
exports.CompletenessStateSchema = zod_1.z.enum(["complete", "partial", "missing"]);
exports.EventSourceSchema = zod_1.z.enum(["desktop", "ide", "browser", "ai", "system"]);
exports.SessionManifestSchema = zod_1.z.object({
    id: zod_1.z.string(),
    name: zod_1.z.string(),
    task_prompt: zod_1.z.string(),
    language: zod_1.z.string(),
    allowed_ai_providers: zod_1.z.array(zod_1.z.string()),
    allowed_sites: zod_1.z.array(zod_1.z.string()),
    required_streams: zod_1.z.array(zod_1.z.string()),
    evidence_settings: zod_1.z.object({
        screenshots_enabled: zod_1.z.boolean().default(false),
        screen_recording_metadata_only: zod_1.z.boolean().default(true)
    }),
    decision_policy: zod_1.z.object({
        auto_advance_min_confidence: zod_1.z.number().min(0).max(1).default(0.9),
        auto_reject_enabled: zod_1.z.boolean().default(false),
        require_full_completeness: zod_1.z.boolean().default(true)
    })
});
exports.EventEnvelopeSchema = zod_1.z.object({
    event_id: zod_1.z.string(),
    session_id: zod_1.z.string(),
    timestamp_utc: zod_1.z.string().datetime(),
    source: exports.EventSourceSchema,
    event_type: zod_1.z.string().min(1),
    sequence_no: zod_1.z.number().int().nonnegative(),
    artifact_ref: zod_1.z.string(),
    payload: zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()),
    client_version: zod_1.z.string(),
    integrity_hash: zod_1.z.string(),
    policy_context: zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()).default({})
});
exports.FeatureSignalSchema = zod_1.z.object({
    name: exports.SignalNameSchema,
    category: zod_1.z.string(),
    classification: exports.SignalClassificationSchema,
    value: zod_1.z.number(),
    completeness: exports.CompletenessStateSchema,
    provenance: zod_1.z.array(zod_1.z.string()),
    description: zod_1.z.string()
});
exports.FeatureVectorSchema = zod_1.z.object({
    session_id: zod_1.z.string(),
    extraction_version: zod_1.z.string(),
    generated_at: zod_1.z.string().datetime(),
    signal_values: zod_1.z.record(zod_1.z.string(), zod_1.z.number()),
    signals: zod_1.z.array(exports.FeatureSignalSchema),
    completeness: exports.CompletenessStateSchema,
    invalidation_reasons: zod_1.z.array(zod_1.z.string()).default([])
});
exports.IntegrityResultSchema = zod_1.z.object({
    verdict: zod_1.z.enum(["clean", "review", "invalid"]),
    flags: zod_1.z.array(zod_1.z.string()),
    required_streams_present: zod_1.z.array(zod_1.z.string()),
    missing_streams: zod_1.z.array(zod_1.z.string()),
    notes: zod_1.z.array(zod_1.z.string())
});
exports.ScoringResultSchema = zod_1.z.object({
    session_id: zod_1.z.string(),
    model_version: zod_1.z.string(),
    haci_score: zod_1.z.number().min(0).max(100),
    haci_band: zod_1.z.enum(["high", "medium", "low"]),
    predicted_archetype: exports.ArchetypeSchema,
    archetype_probabilities: zod_1.z.record(zod_1.z.string(), zod_1.z.number()),
    confidence: zod_1.z.number().min(0).max(1),
    top_features: zod_1.z.array(zod_1.z.object({
        name: exports.SignalNameSchema,
        contribution: zod_1.z.number()
    })),
    integrity: exports.IntegrityResultSchema,
    policy_recommendation: zod_1.z.enum(["auto-advance", "human-review", "invalid-session"]),
    review_required: zod_1.z.boolean()
});
exports.haciWeights = {
    typing_vs_paste_ratio: 0.25,
    prompt_refinement_count: 0.25,
    time_to_first_ai_prompt: 0.15,
    ai_output_edit_distance: 0.15,
    max_paste_length: -0.2
};
exports.haciBounds = {
    typing_vs_paste_ratio: [0, 5],
    prompt_refinement_count: [0, 15],
    time_to_first_ai_prompt: [0, 1800],
    ai_output_edit_distance: [0, 500],
    max_paste_length: [0, 2000]
};
//# sourceMappingURL=types.js.map