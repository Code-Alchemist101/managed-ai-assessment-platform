from __future__ import annotations

import math
import os
from pathlib import Path
from typing import Any
import pandas as pd

import joblib

from .catalog import ARCHETYPES, HACI_BOUNDS, HACI_WEIGHTS, MODEL_VERSION
from .features import extract_feature_vector
from .integrity import evaluate_integrity


ARTIFACTS_DIR = Path(__file__).resolve().parents[1] / "artifacts"

_ALLOWED_ARCHETYPE_MODES = {"heuristic", "trained_model"}


def _get_archetype_mode() -> str:
    configured_mode = os.getenv("ARCHETYPE_MODE", "heuristic").strip().lower()
    if configured_mode in _ALLOWED_ARCHETYPE_MODES:
        return configured_mode
    return "heuristic"


ARCHETYPE_MODE = _get_archetype_mode()

TRAINED_MODEL_VERSION = "xgboost-research-v1"

_MODEL_BUNDLE: dict[str, Any] | None = None
_MODEL_LOAD_ERROR: str | None = None


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


def _load_model_bundle() -> dict[str, Any] | None:
    global _MODEL_BUNDLE, _MODEL_LOAD_ERROR

    if _MODEL_BUNDLE is not None:
        return _MODEL_BUNDLE

    # If a previous load failed, retry only if the primary artifact now exists on
    # disk (e.g. after a delayed volume mount).  This avoids permanently disabling
    # trained-model scoring due to a transient I/O error.
    if _MODEL_LOAD_ERROR is not None:
        if not (ARTIFACTS_DIR / "archetype_xgboost.pkl").exists():
            return None
        _MODEL_LOAD_ERROR = None

    try:
        model_path = ARTIFACTS_DIR / "archetype_xgboost.pkl"
        scaler_path = ARTIFACTS_DIR / "feature_scaler.pkl"
        encoder_path = ARTIFACTS_DIR / "label_encoder.pkl"
        feature_names_path = ARTIFACTS_DIR / "feature_names.pkl"

        _MODEL_BUNDLE = {
            "model": joblib.load(model_path),
            "scaler": joblib.load(scaler_path),
            "label_encoder": joblib.load(encoder_path),
            "feature_names": joblib.load(feature_names_path),
        }
        return _MODEL_BUNDLE
    except Exception as exc:
        _MODEL_LOAD_ERROR = str(exc)
        return None


def _predict_with_trained_model(signal_values: dict[str, float]) -> tuple[dict[str, float], str, float] | None:
    bundle = _load_model_bundle()
    if bundle is None:
        return None

    model = bundle["model"]
    scaler = bundle["scaler"]
    label_encoder = bundle["label_encoder"]
    feature_names = bundle["feature_names"]

    if not isinstance(feature_names, list) or not feature_names:
        return None

    ordered_values = [float(signal_values.get(name, 0.0)) for name in feature_names]

    try:
        input_df = pd.DataFrame([ordered_values], columns=feature_names)
        scaled_values = scaler.transform(input_df)
        probabilities_array = model.predict_proba(scaled_values)[0]
        class_names = list(label_encoder.classes_)

        probabilities = {
            class_name: round(float(prob), 4)
            for class_name, prob in zip(class_names, probabilities_array, strict=False)
        }

        predicted_archetype = max(probabilities, key=probabilities.get)
        confidence = round(float(probabilities[predicted_archetype]), 4)
        return probabilities, predicted_archetype, confidence
    except Exception:
        return None


def score_session(events: list[dict[str, Any]], session_context: dict[str, Any] | None = None) -> dict[str, Any]:
    feature_vector = extract_feature_vector(events, session_context=session_context)
    signal_values = feature_vector["signal_values"]
    integrity = evaluate_integrity(events, feature_vector, session_context=session_context)

    # Always compute heuristic result.
    heuristic_archetype_scores = _bootstrap_archetype_scores(signal_values)
    heuristic_probabilities = {key: round(value, 4) for key, value in _softmax(heuristic_archetype_scores).items()}
    heuristic_predicted_archetype = max(heuristic_probabilities, key=heuristic_probabilities.get)
    heuristic_confidence = round(float(heuristic_probabilities[heuristic_predicted_archetype]), 4)
    heuristic_result: dict[str, Any] = {
        "scoring_mode": "heuristic",
        "model_version": MODEL_VERSION,
        "predicted_archetype": heuristic_predicted_archetype,
        "archetype_probabilities": heuristic_probabilities,
        "confidence": heuristic_confidence,
    }

    # Always attempt trained-model result, regardless of ARCHETYPE_MODE, so
    # both paths are visible to the reviewer when artifacts are available.
    trained_result_data = _predict_with_trained_model(signal_values)
    trained_model_result: dict[str, Any] | None = None
    if trained_result_data is not None:
        tm_probabilities, tm_predicted_archetype, tm_confidence = trained_result_data
        trained_model_result = {
            "scoring_mode": "trained_model",
            "model_version": TRAINED_MODEL_VERSION,
            "predicted_archetype": tm_predicted_archetype,
            "archetype_probabilities": tm_probabilities,
            "confidence": tm_confidence,
        }

    # The active result (used for policy decisions) is controlled by ARCHETYPE_MODE.
    if ARCHETYPE_MODE == "trained_model" and trained_model_result is not None:
        scoring_mode = "trained_model"
        model_version = TRAINED_MODEL_VERSION
        probabilities = trained_model_result["archetype_probabilities"]
        predicted_archetype = trained_model_result["predicted_archetype"]
        confidence = trained_model_result["confidence"]
    else:
        scoring_mode = "heuristic"
        model_version = MODEL_VERSION
        probabilities = heuristic_probabilities
        predicted_archetype = heuristic_predicted_archetype
        confidence = heuristic_confidence

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
        "model_version": model_version,
        "scoring_mode": scoring_mode,
        "haci_score": haci_score,
        "haci_band": haci_band,
        "predicted_archetype": predicted_archetype,
        "archetype_probabilities": probabilities,
        "confidence": confidence,
        "top_features": top_features[:5],
        "integrity": integrity,
        "policy_recommendation": policy_recommendation,
        "review_required": review_required,
        "heuristic_result": heuristic_result,
        "trained_model_result": trained_model_result,
        "feature_vector": feature_vector,
    }