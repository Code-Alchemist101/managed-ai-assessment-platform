from __future__ import annotations

from typing import Any

from fastapi import FastAPI
from pydantic import BaseModel, Field

from .catalog import MODEL_VERSION
from .features import extract_feature_vector
from .integrity import evaluate_integrity
from .scoring import (
    ARCHETYPE_MODE,
    TRAINED_MODEL_VERSION,
    _load_model_bundle,
    score_session,
)


class SessionPayload(BaseModel):
    session_context: dict = Field(default_factory=dict)
    events: list[dict]


app = FastAPI(title="Assessment Analytics API", version="0.1.0")


@app.get("/health")
def health() -> dict[str, Any]:
    if ARCHETYPE_MODE == "trained_model":
        model_ready = _load_model_bundle() is not None
        active_version = TRAINED_MODEL_VERSION if model_ready else MODEL_VERSION
    else:
        model_ready = None
        active_version = MODEL_VERSION
    return {
        "status": "ok",
        "scoring_mode": ARCHETYPE_MODE,
        "model_version": active_version,
        "trained_model_available": model_ready,
    }


@app.post("/extract-features")
def extract_features_endpoint(payload: SessionPayload) -> dict:
    return extract_feature_vector(payload.events, session_context=payload.session_context)


@app.post("/integrity")
def integrity_endpoint(payload: SessionPayload) -> dict:
    feature_vector = extract_feature_vector(payload.events, session_context=payload.session_context)
    return evaluate_integrity(payload.events, feature_vector, session_context=payload.session_context)


@app.post("/score-session")
def score_session_endpoint(payload: SessionPayload) -> dict:
    return score_session(payload.events, session_context=payload.session_context)

