import { z } from "zod";
export declare const signalCatalog: {
    name: string;
    category: string;
    classification: string;
    description: string;
    required_streams: string[];
}[];
export declare const signalNames: [string, ...string[]];
export declare const archetypes: readonly ["Independent Solver", "Structured Collaborator", "Prompt Engineer Solver", "Iterative Debugger", "AI-Dependent Constructor", "Blind Copier", "Exploratory Learner"];
export declare const ArchetypeSchema: z.ZodEnum<["Independent Solver", "Structured Collaborator", "Prompt Engineer Solver", "Iterative Debugger", "AI-Dependent Constructor", "Blind Copier", "Exploratory Learner"]>;
export declare const SignalNameSchema: z.ZodEnum<[string, ...string[]]>;
export declare const SignalClassificationSchema: z.ZodEnum<["direct", "derived", "controlled-only", "inferred"]>;
export declare const CompletenessStateSchema: z.ZodEnum<["complete", "partial", "missing"]>;
export declare const EventSourceSchema: z.ZodEnum<["desktop", "ide", "browser", "ai", "system"]>;
export declare const SessionManifestSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    task_prompt: z.ZodString;
    language: z.ZodString;
    allowed_ai_providers: z.ZodArray<z.ZodString, "many">;
    allowed_sites: z.ZodArray<z.ZodString, "many">;
    required_streams: z.ZodArray<z.ZodString, "many">;
    evidence_settings: z.ZodObject<{
        screenshots_enabled: z.ZodDefault<z.ZodBoolean>;
        screen_recording_metadata_only: z.ZodDefault<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        screenshots_enabled: boolean;
        screen_recording_metadata_only: boolean;
    }, {
        screenshots_enabled?: boolean | undefined;
        screen_recording_metadata_only?: boolean | undefined;
    }>;
    decision_policy: z.ZodObject<{
        auto_advance_min_confidence: z.ZodDefault<z.ZodNumber>;
        auto_reject_enabled: z.ZodDefault<z.ZodBoolean>;
        require_full_completeness: z.ZodDefault<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        auto_advance_min_confidence: number;
        auto_reject_enabled: boolean;
        require_full_completeness: boolean;
    }, {
        auto_advance_min_confidence?: number | undefined;
        auto_reject_enabled?: boolean | undefined;
        require_full_completeness?: boolean | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    id: string;
    name: string;
    task_prompt: string;
    language: string;
    allowed_ai_providers: string[];
    allowed_sites: string[];
    required_streams: string[];
    evidence_settings: {
        screenshots_enabled: boolean;
        screen_recording_metadata_only: boolean;
    };
    decision_policy: {
        auto_advance_min_confidence: number;
        auto_reject_enabled: boolean;
        require_full_completeness: boolean;
    };
}, {
    id: string;
    name: string;
    task_prompt: string;
    language: string;
    allowed_ai_providers: string[];
    allowed_sites: string[];
    required_streams: string[];
    evidence_settings: {
        screenshots_enabled?: boolean | undefined;
        screen_recording_metadata_only?: boolean | undefined;
    };
    decision_policy: {
        auto_advance_min_confidence?: number | undefined;
        auto_reject_enabled?: boolean | undefined;
        require_full_completeness?: boolean | undefined;
    };
}>;
export declare const EventEnvelopeSchema: z.ZodObject<{
    event_id: z.ZodString;
    session_id: z.ZodString;
    timestamp_utc: z.ZodString;
    source: z.ZodEnum<["desktop", "ide", "browser", "ai", "system"]>;
    event_type: z.ZodString;
    sequence_no: z.ZodNumber;
    artifact_ref: z.ZodString;
    payload: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    client_version: z.ZodString;
    integrity_hash: z.ZodString;
    policy_context: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, "strip", z.ZodTypeAny, {
    event_id: string;
    session_id: string;
    timestamp_utc: string;
    source: "ide" | "desktop" | "browser" | "ai" | "system";
    event_type: string;
    sequence_no: number;
    artifact_ref: string;
    payload: Record<string, unknown>;
    client_version: string;
    integrity_hash: string;
    policy_context: Record<string, unknown>;
}, {
    event_id: string;
    session_id: string;
    timestamp_utc: string;
    source: "ide" | "desktop" | "browser" | "ai" | "system";
    event_type: string;
    sequence_no: number;
    artifact_ref: string;
    payload: Record<string, unknown>;
    client_version: string;
    integrity_hash: string;
    policy_context?: Record<string, unknown> | undefined;
}>;
export declare const FeatureSignalSchema: z.ZodObject<{
    name: z.ZodEnum<[string, ...string[]]>;
    category: z.ZodString;
    classification: z.ZodEnum<["direct", "derived", "controlled-only", "inferred"]>;
    value: z.ZodNumber;
    completeness: z.ZodEnum<["complete", "partial", "missing"]>;
    provenance: z.ZodArray<z.ZodString, "many">;
    description: z.ZodString;
}, "strip", z.ZodTypeAny, {
    name: string;
    value: number;
    category: string;
    classification: "direct" | "controlled-only" | "derived" | "inferred";
    completeness: "complete" | "partial" | "missing";
    provenance: string[];
    description: string;
}, {
    name: string;
    value: number;
    category: string;
    classification: "direct" | "controlled-only" | "derived" | "inferred";
    completeness: "complete" | "partial" | "missing";
    provenance: string[];
    description: string;
}>;
export declare const FeatureVectorSchema: z.ZodObject<{
    session_id: z.ZodString;
    extraction_version: z.ZodString;
    generated_at: z.ZodString;
    signal_values: z.ZodRecord<z.ZodString, z.ZodNumber>;
    signals: z.ZodArray<z.ZodObject<{
        name: z.ZodEnum<[string, ...string[]]>;
        category: z.ZodString;
        classification: z.ZodEnum<["direct", "derived", "controlled-only", "inferred"]>;
        value: z.ZodNumber;
        completeness: z.ZodEnum<["complete", "partial", "missing"]>;
        provenance: z.ZodArray<z.ZodString, "many">;
        description: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        name: string;
        value: number;
        category: string;
        classification: "direct" | "controlled-only" | "derived" | "inferred";
        completeness: "complete" | "partial" | "missing";
        provenance: string[];
        description: string;
    }, {
        name: string;
        value: number;
        category: string;
        classification: "direct" | "controlled-only" | "derived" | "inferred";
        completeness: "complete" | "partial" | "missing";
        provenance: string[];
        description: string;
    }>, "many">;
    completeness: z.ZodEnum<["complete", "partial", "missing"]>;
    invalidation_reasons: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
}, "strip", z.ZodTypeAny, {
    session_id: string;
    completeness: "complete" | "partial" | "missing";
    extraction_version: string;
    generated_at: string;
    signal_values: Record<string, number>;
    signals: {
        name: string;
        value: number;
        category: string;
        classification: "direct" | "controlled-only" | "derived" | "inferred";
        completeness: "complete" | "partial" | "missing";
        provenance: string[];
        description: string;
    }[];
    invalidation_reasons: string[];
}, {
    session_id: string;
    completeness: "complete" | "partial" | "missing";
    extraction_version: string;
    generated_at: string;
    signal_values: Record<string, number>;
    signals: {
        name: string;
        value: number;
        category: string;
        classification: "direct" | "controlled-only" | "derived" | "inferred";
        completeness: "complete" | "partial" | "missing";
        provenance: string[];
        description: string;
    }[];
    invalidation_reasons?: string[] | undefined;
}>;
export declare const IntegrityResultSchema: z.ZodObject<{
    verdict: z.ZodEnum<["clean", "review", "invalid"]>;
    flags: z.ZodArray<z.ZodString, "many">;
    required_streams_present: z.ZodArray<z.ZodString, "many">;
    missing_streams: z.ZodArray<z.ZodString, "many">;
    notes: z.ZodArray<z.ZodString, "many">;
}, "strip", z.ZodTypeAny, {
    verdict: "clean" | "review" | "invalid";
    flags: string[];
    required_streams_present: string[];
    missing_streams: string[];
    notes: string[];
}, {
    verdict: "clean" | "review" | "invalid";
    flags: string[];
    required_streams_present: string[];
    missing_streams: string[];
    notes: string[];
}>;
export declare const ScoringResultSchema: z.ZodObject<{
    session_id: z.ZodString;
    model_version: z.ZodString;
    haci_score: z.ZodNumber;
    haci_band: z.ZodEnum<["high", "medium", "low"]>;
    predicted_archetype: z.ZodEnum<["Independent Solver", "Structured Collaborator", "Prompt Engineer Solver", "Iterative Debugger", "AI-Dependent Constructor", "Blind Copier", "Exploratory Learner"]>;
    archetype_probabilities: z.ZodRecord<z.ZodString, z.ZodNumber>;
    confidence: z.ZodNumber;
    top_features: z.ZodArray<z.ZodObject<{
        name: z.ZodEnum<[string, ...string[]]>;
        contribution: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        name: string;
        contribution: number;
    }, {
        name: string;
        contribution: number;
    }>, "many">;
    integrity: z.ZodObject<{
        verdict: z.ZodEnum<["clean", "review", "invalid"]>;
        flags: z.ZodArray<z.ZodString, "many">;
        required_streams_present: z.ZodArray<z.ZodString, "many">;
        missing_streams: z.ZodArray<z.ZodString, "many">;
        notes: z.ZodArray<z.ZodString, "many">;
    }, "strip", z.ZodTypeAny, {
        verdict: "clean" | "review" | "invalid";
        flags: string[];
        required_streams_present: string[];
        missing_streams: string[];
        notes: string[];
    }, {
        verdict: "clean" | "review" | "invalid";
        flags: string[];
        required_streams_present: string[];
        missing_streams: string[];
        notes: string[];
    }>;
    policy_recommendation: z.ZodEnum<["auto-advance", "human-review", "invalid-session"]>;
    review_required: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    session_id: string;
    model_version: string;
    haci_score: number;
    haci_band: "high" | "medium" | "low";
    predicted_archetype: "Independent Solver" | "Structured Collaborator" | "Prompt Engineer Solver" | "Iterative Debugger" | "AI-Dependent Constructor" | "Blind Copier" | "Exploratory Learner";
    archetype_probabilities: Record<string, number>;
    confidence: number;
    top_features: {
        name: string;
        contribution: number;
    }[];
    integrity: {
        verdict: "clean" | "review" | "invalid";
        flags: string[];
        required_streams_present: string[];
        missing_streams: string[];
        notes: string[];
    };
    policy_recommendation: "auto-advance" | "human-review" | "invalid-session";
    review_required: boolean;
}, {
    session_id: string;
    model_version: string;
    haci_score: number;
    haci_band: "high" | "medium" | "low";
    predicted_archetype: "Independent Solver" | "Structured Collaborator" | "Prompt Engineer Solver" | "Iterative Debugger" | "AI-Dependent Constructor" | "Blind Copier" | "Exploratory Learner";
    archetype_probabilities: Record<string, number>;
    confidence: number;
    top_features: {
        name: string;
        contribution: number;
    }[];
    integrity: {
        verdict: "clean" | "review" | "invalid";
        flags: string[];
        required_streams_present: string[];
        missing_streams: string[];
        notes: string[];
    };
    policy_recommendation: "auto-advance" | "human-review" | "invalid-session";
    review_required: boolean;
}>;
export declare const haciWeights: {
    readonly typing_vs_paste_ratio: 0.25;
    readonly prompt_refinement_count: 0.25;
    readonly time_to_first_ai_prompt: 0.15;
    readonly ai_output_edit_distance: 0.15;
    readonly max_paste_length: -0.2;
};
export declare const haciBounds: {
    readonly typing_vs_paste_ratio: readonly [0, 5];
    readonly prompt_refinement_count: readonly [0, 15];
    readonly time_to_first_ai_prompt: readonly [0, 1800];
    readonly ai_output_edit_distance: readonly [0, 500];
    readonly max_paste_length: readonly [0, 2000];
};
export type SessionManifest = z.infer<typeof SessionManifestSchema>;
export type EventEnvelope = z.infer<typeof EventEnvelopeSchema>;
export type FeatureSignal = z.infer<typeof FeatureSignalSchema>;
export type FeatureVector = z.infer<typeof FeatureVectorSchema>;
export type IntegrityResult = z.infer<typeof IntegrityResultSchema>;
export type ScoringResult = z.infer<typeof ScoringResultSchema>;
