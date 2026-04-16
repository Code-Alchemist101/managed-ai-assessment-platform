# Model Card — xgboost-research-v1

This document records the provenance and known properties of the trained archetype classifier currently shipped with the analytics service. It is grounded strictly in files present in this repository.

---

## Model Identity

| Field | Value |
|---|---|
| Model identifier | `xgboost-research-v1` |
| Algorithm | XGBoost multi-class classifier (`XGBClassifier`, objective: `multi:softprob`) |
| Artifact location | `services/analytics-py/artifacts/` |
| Artifact files | `archetype_xgboost.pkl`, `feature_scaler.pkl`, `label_encoder.pkl`, `feature_names.pkl` |

---

## Task

The model predicts one of seven behavioral archetypes for a candidate software engineering assessment session:

- AI-Dependent Constructor
- Blind Copier
- Exploratory Learner
- Independent Solver
- Iterative Debugger
- Prompt Engineer Solver
- Structured Collaborator

These archetypes are defined in `services/analytics-py/assessment_analytics/catalog.py`. The model is a component of the analytics service and is an alternative to the default heuristic scorer (`bootstrap-centroid-v1`). Which scorer is active at runtime is controlled by the `ARCHETYPE_MODE` environment variable; the heuristic mode is the default.

---

## Input Features

The model takes a 51-dimensional input vector. The feature set exactly matches the 51 signals defined in `packages/contracts/src/signal-catalog.json` and extracted by `services/analytics-py/assessment_analytics/features.py`. The signals span five categories:

| Category | Count |
|---|---|
| IDE Interaction | 10 |
| Typing Dynamics | 9 |
| Code Evolution | 10 |
| AI Prompt Interaction | 12 |
| Temporal Workflow | 10 |

Each feature is derived from managed telemetry events emitted during an assessment session. Full descriptions and classification (`direct`, `derived`, `controlled-only`, `inferred`) are in the signal catalog.

**Preprocessing:** The 51 features are standardized at inference time using a `StandardScaler` (scikit-learn) fitted at training time and stored in `feature_scaler.pkl`.

---

## Hyperparameters

These values are readable from the artifact file `archetype_xgboost.pkl`:

| Parameter | Value |
|---|---|
| `n_estimators` | 100 |
| `max_depth` | 5 |
| `learning_rate` | 0.1 |
| `objective` | `multi:softprob` |
| `random_state` | 42 |

All other XGBoost parameters were left at library defaults when the model was fitted.

---

## Library Versions Used at Training Time

These versions are recorded in `services/analytics-py/artifacts/model_versions.json`:

| Library | Version |
|---|---|
| xgboost | 3.2.0 |
| scikit-learn | 1.6.1 |
| joblib | 1.5.3 |
| numpy | 2.0.2 |

---

## Training Data

No training data, data-generation scripts, or training notebooks are present in this repository. The model artifacts are committed as pre-built binary files. The following is known from context in this repository:

- The version suffix `-research-v1` is used to distinguish this from the heuristic baseline.
- No further information about the origin, size, or composition of the training data is available in any file in this repository.
- No claims about whether training data was human-collected or synthetically generated can be made from the files present here.

---

## Evaluation

No evaluation results (accuracy, F1, per-class metrics, confusion matrix, or held-out test set results) are present anywhere in this repository. The model has not been externally benchmarked or validated against real-world labeled sessions based on available files.

---

## How the Model Is Used at Runtime

1. `score_session()` in `services/analytics-py/assessment_analytics/scoring.py` always attempts to load and run the trained model regardless of `ARCHETYPE_MODE`.
2. When artifacts load successfully, a `trained_model_result` block is included in the scoring output alongside the `heuristic_result`.
3. Only the result controlled by `ARCHETYPE_MODE` becomes the active top-level prediction for policy decisions. If `ARCHETYPE_MODE` is `heuristic` (the default), the trained-model output is computed but not used for policy.
4. If the model artifacts fail to load, the service falls back to heuristic mode automatically and never errors out.
5. The `/health` endpoint reports the configured scoring mode, the active scoring mode after any fallback, and whether trained-model artifacts loaded successfully.

---

## Confidence Output

The model outputs `archetype_probabilities` (from `predict_proba`), and `confidence` is the probability of the top predicted class. These values are **not calibrated probabilities**; they reflect the relative model output across the seven classes. They should not be interpreted as frequentist likelihoods or population baselines.

---

## Known Limitations

The following limitations are grounded in code and documentation in this repository:

1. **Sparse-session bias.** Very short sessions with fewer than 10 events, typing-only edits, and no AI prompt telemetry may produce unreliable archetype predictions. The integrity layer adds a `low_information_session` flag in this case (see `integrity.py:76–90`). The flag is surfaced to reviewers but does not block scoring.

2. **Controlled-only signals may be absent.** Twelve of the 51 signals are classified `controlled-only` and require managed client telemetry (IDE extension or browser extension). If those streams are missing, their values default to zero, which can distort model input.

3. **No training data in repo.** Because the training dataset is not present, it is not possible to audit for label noise, class imbalance, or distributional mismatch between training conditions and real assessment conditions.

4. **No held-out evaluation.** No test-set metrics are stored in the repository. Performance on real sessions is unknown from available files.

5. **Library version mismatch at inference.** The artifacts were serialized with scikit-learn 1.6.1. Loading them with a different scikit-learn version may produce `InconsistentVersionWarning` and could—in principle—produce silent numeric differences. The `model_versions.json` file records the training-time versions.

6. **One model per repo.** There is a single trained model artifact. There is no versioning infrastructure for iterating or comparing model variants.

---

## What This Document Does Not Cover

- Model fairness or demographic bias analysis (no labeled real-session data is available in this repository).
- Population benchmark comparisons (no reference population is defined in any file here).
- Deployment security or adversarial robustness.
