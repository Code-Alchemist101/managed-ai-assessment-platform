# Architecture Notes

For the latest local validation snapshot, see [Release Status](/C:/Users/hosan/Desktop/Research%20Project/assessment-platform/docs/release-status.md).

## Product runtime

- The desktop controller is the managed root of trust on Windows.
- VS Code and Edge act as telemetry clients and deliver canonical event envelopes.
- The ingestion API persists immutable raw events and artifacts.
- The analytics service recomputes the authoritative 51-signal vector, integrity verdict, HACI, and archetype probabilities.
- The control-plane API manages manifests, sessions, and review-facing summaries.

## Scoring modes

The analytics service supports two archetype scoring modes, controlled by the `ARCHETYPE_MODE` environment variable:

- **heuristic** (default) — uses handcrafted centroid-based scoring (`bootstrap-centroid-v1`). No external model artifacts required.
- **trained_model** — uses an XGBoost classifier (`xgboost-research-v1`) loaded from `services/analytics-py/artifacts/`. If model artifacts are missing or corrupt, scoring falls back to heuristic mode automatically.

HACI computation is independent of the archetype scoring mode and produces identical results for the same input session regardless of which mode is active.

The `/health` endpoint reports both the `configured_scoring_mode` (what `ARCHETYPE_MODE` is set to) and the `active_scoring_mode` (what is actually running after any fallback), along with the model version and whether trained-model artifacts loaded successfully.

## Data flow

1. Control plane issues a session manifest.
2. Desktop controller launches a managed VS Code workspace and managed Edge profile.
3. Extensions stream event envelopes to the local controller.
4. The controller forwards events to the ingestion API and spools locally if the network is unavailable.
5. Analytics reads raw events and computes the authoritative feature vector.
6. Scoring returns HACI, archetype probabilities, confidence, integrity flags, and the active scoring mode.
7. Reviewer and admin apps consume control-plane views backed by analytics outputs.

## Local persistence

- Raw per-session events:
  - `.runtime-data/local-dev/ingestion/sessions/<sessionId>.ndjson`
- Session inventory:
  - `.runtime-data/local-dev/control-plane/sessions.json`
- Scoring payloads:
  - `.runtime-data/local-dev/control-plane/scorings/<sessionId>.json`

This makes the local system auditable from raw events to final score.

## Product guardrails

- Sessions are valid only when required telemetry streams are present.
- Unsupported AI providers or unmanaged browser usage must be flagged.
- Integrity is evaluated separately from archetype scoring.
- Historical results stay pinned to feature extraction and scoring versions.
- A session can still score successfully while landing in `review` if integrity flags are present.
- Trained-model scoring must always fall back to heuristic mode on artifact load failure, never error out.
