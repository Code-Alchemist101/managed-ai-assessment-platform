from __future__ import annotations

from fastapi import FastAPI
from pydantic import BaseModel, Field

from .features import extract_feature_vector
from .integrity import evaluate_integrity
from .scoring import score_session


class SessionPayload(BaseModel):
    session_context: dict = Field(default_factory=dict)
    events: list[dict]


app = FastAPI(title="Assessment Analytics API", version="0.1.0")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


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

