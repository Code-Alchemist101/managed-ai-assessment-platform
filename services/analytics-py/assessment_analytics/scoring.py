from __future__ import annotations

import math
from typing import Any

from .catalog import ARCHETYPES, HACI_BOUNDS, HACI_WEIGHTS, MODEL_VERSION
from .features import extract_feature_vector
from .integrity import evaluate_integrity


def _normalize(value: float, lower: float, upper: float) -> float:
    if upper <= lower:
        return 0.0
    clamped = min(max(value, lower), upper)
    return (clamped - lower) / (upper - lower)


def _softmax(scores: dict[str, float]) -> dict[str, float]:
    max_score = max(scores.values())
    exponentials = {key: math.exp(value - max_score) for key, value in scores.items()}
    total = sum(exponentials.values()) or 1.0
    return {key: value / total for key, value in exponentials.items()}


def _bootstrap_archetype_scores(signal_values: dict[str, float]) -> dict[str, float]:
    ratio = signal_values["typing_vs_paste_ratio"]
    prompts = signal_values["total_prompts_sent"]
    prompt_refinement = signal_values["prompt_refinement_count"]
    prompt_length = signal_values["avg_prompt_length"]
    debug_ratio = signal_values["debugging_prompt_ratio"]
    run_events = signal_values["run_compile_events"]
    acceptance = signal_values["ai_response_acceptance_rate"]
    paste_length = signal_values["max_paste_length"]
    ai_latency = signal_values["time_to_first_ai_prompt"]
    entropy = signal_values["prompt_entropy"]
    session_duration = signal_values["session_duration"]
    browser_ratio = signal_values["browser_to_editor_ratio"]
    edit_distance = signal_values["ai_output_edit_distance"]
    solution_ratio = signal_values["solution_request_ratio"]
    clarification_ratio = signal_values["clarification_prompt_ratio"]

    return {
        "Independent Solver": (
            min(ratio, 8) * 0.35
            + min(ai_latency / 600, 3) * 0.20
            + signal_values["code_rewrite_ratio"] * 0.25
            + (1 - min(acceptance, 1)) * 0.20
        ),
        "Structured Collaborator": (
            min(prompts / 10, 2) * 0.20
            + min(prompt_refinement / 5, 2) * 0.30
            + min(edit_distance / 150, 2) * 0.20
            + clarification_ratio * 0.15
            + (1 - min(solution_ratio, 1)) * 0.15
        ),
        "Prompt Engineer Solver": (
            min(prompt_length / 80, 2) * 0.35
            + min(prompt_refinement / 5, 2) * 0.30
            + min(edit_distance / 150, 2) * 0.15
            + min(ratio, 5) * 0.20
        ),
        "Iterative Debugger": (
            min(run_events / 5, 3) * 0.35
            + debug_ratio * 0.30
            + min(signal_values["compile_error_count"] / 5, 3) * 0.20
            + signal_values["ai_usage_late_ratio"] * 0.15
        ),
        "AI-Dependent Constructor": (
            min(prompts / 12, 3) * 0.20
            + acceptance * 0.30
            + (1 - min(ratio / 2, 1)) * 0.20
            + browser_ratio * 0.15
            + (1 - min(ai_latency / 300, 1)) * 0.15
        ),
        "Blind Copier": (
            min(paste_length / 1000, 3) * 0.35
            + acceptance * 0.25
            + (1 - min(edit_distance / 50, 1)) * 0.20
            + solution_ratio * 0.10
            + (1 - min(ai_latency / 120, 1)) * 0.10
        ),
        "Exploratory Learner": (
            entropy * 0.30
            + clarification_ratio * 0.20
            + min(session_duration / 3600, 3) * 0.20
            + min(signal_values["avg_pause_duration"] / 10, 2) * 0.15
            + min(signal_values["comment_addition_count"] / 5, 2) * 0.15
        ),
    }


def _compute_haci(signal_values: dict[str, float]) -> tuple[float, list[dict[str, float]]]:
    raw_score = 0.0
    contributions = []
    theoretical_min = sum(weight for weight in HACI_WEIGHTS.values() if weight < 0)
    theoretical_max = sum(weight for weight in HACI_WEIGHTS.values() if weight > 0)
    for feature_name, weight in HACI_WEIGHTS.items():
        lower, upper = HACI_BOUNDS[feature_name]
        normalized = _normalize(signal_values.get(feature_name, 0.0), lower, upper)
        contribution = normalized * weight
        raw_score += contribution
        contributions.append({"name": feature_name, "contribution": round(contribution, 4)})
    haci_score = (raw_score - theoretical_min) / (theoretical_max - theoretical_min) * 100
    top_features = sorted(contributions, key=lambda item: abs(item["contribution"]), reverse=True)
    return max(0.0, min(100.0, round(haci_score, 1))), top_features


def score_session(events: list[dict[str, Any]], session_context: dict[str, Any] | None = None) -> dict[str, Any]:
    feature_vector = extract_feature_vector(events, session_context=session_context)
    signal_values = feature_vector["signal_values"]
    integrity = evaluate_integrity(events, feature_vector, session_context=session_context)

    archetype_scores = _bootstrap_archetype_scores(signal_values)
    probabilities = _softmax(archetype_scores)
    predicted_archetype = max(probabilities, key=probabilities.get)
    confidence = round(probabilities[predicted_archetype], 4)
    haci_score, top_features = _compute_haci(signal_values)

    if haci_score >= 70:
        haci_band = "high"
    elif haci_score >= 40:
        haci_band = "medium"
    else:
        haci_band = "low"

    policy_recommendation = "human-review"
    review_required = True
    if integrity["verdict"] == "invalid":
        policy_recommendation = "invalid-session"
    elif integrity["verdict"] == "clean" and confidence >= 0.90 and haci_score >= 65:
        policy_recommendation = "auto-advance"
        review_required = False

    return {
        "session_id": feature_vector["session_id"],
        "model_version": MODEL_VERSION,
        "haci_score": haci_score,
        "haci_band": haci_band,
        "predicted_archetype": predicted_archetype,
        "archetype_probabilities": {key: round(value, 4) for key, value in probabilities.items()},
        "confidence": confidence,
        "top_features": top_features[:5],
        "integrity": integrity,
        "policy_recommendation": policy_recommendation,
        "review_required": review_required,
        "feature_vector": feature_vector,
    }

