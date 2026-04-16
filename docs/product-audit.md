# Product Audit — Managed AI Assessment Platform

**Date:** April 16, 2026  
**Branch:** `main`  
**Scope:** Brutally honest, code-grounded, product-focused. No flattery. No architecture restatement.

---

## Part 1 — Current Strength

### Telemetry / Signal Capture — **Decent but incomplete**

The feature extraction pipeline (`assessment_analytics/features.py`) correctly processes 51 named signals from desktop, IDE, and browser event streams. The signal catalog is shared between Python and TypeScript via a single JSON file, which is a clean and practical design. Provenance tracking (which streams contributed to which signals) is real and already reported to the reviewer.

What keeps this from "strong":

- The live capture path is **Windows-only**. All `path.win32` usage in `apps/desktop-controller/src/session-helpers.ts` and the Edge-launch logic are Windows-specific. On any other OS, the live path does not exist.
- There is exactly **one fixture** (`fixtures/sample-session.json`) backing all regression tests. That is not a regression baseline; it is a single data point. A code change that subtly shifts signal extraction would only be caught if it affected that specific session.
- `extract_function_map()` in `utils.py` uses a Python-only `def`-matching regex. For non-Python assessments, the `function_rewrite_count` signal is always zero. The platform is currently Python-only in practice.
- Ingestion is append-only NDJSON per session. There is no event deduplication. If a client replays events, they accumulate silently.

### Analytics / Scoring — **Decent but incomplete**

The pipeline (`scoring.py`) correctly wires feature extraction → HACI → heuristic scoring → trained-model scoring → policy recommendation. The dual-mode output (always computing both, ARCHETYPE_MODE controlling the active path) is a sound design.

What keeps this from "strong":

- **HACI uses 5 of the 51 signals** with completely hand-assigned weights (`typing_vs_paste_ratio: 0.25`, `prompt_refinement_count: 0.25`, `time_to_first_ai_prompt: 0.15`, `ai_output_edit_distance: 0.15`, `max_paste_length: -0.20`). The remaining 46 signals contribute exactly zero to HACI. That's not a validated index; it's a prototype placeholder wearing a serious-sounding name.
- The heuristic archetype scoring in `_bootstrap_archetype_scores()` consists entirely of magic-number formulas — `min(ratio, 8) * 0.35`, `min(ai_latency / 600, 3) * 0.20`, etc. There is no documentation of where these numbers came from and no empirical validation that they separate the archetypes in practice.
- The **"confidence" returned from the heuristic path is a softmax probability**, not a calibrated confidence. If the top archetype's softmax mass is 0.42, that does not mean "this classification is 42% likely to be correct." It means the heuristic formula scores were spread. Reviewers and policy logic treating this as a confidence metric are operating on a misleading signal.
- The auto-advance policy threshold (`confidence >= 0.90 AND haci_score >= 65`) is arbitrary. No real candidate population has been used to calibrate when this threshold is safe to trust.

### Heuristic vs Trained-Model Behavior — **Decent but incomplete**

Both results are computed and returned in every scoring call. The contracts include `heuristic_result` and `trained_model_result` as optional fields. The reviewer UI now displays both side by side. This is correctly implemented.

What keeps this from "strong":

- The trained model is labeled `xgboost-research-v1`. The word "research" is there for a reason. `artifacts/model_versions.json` records only library versions (`xgboost: 3.2.0`, `scikit-learn: 1.6.1`), not training data provenance, training accuracy, cross-validation results, or generalization bounds. The model is a pickle blob with no documented pedigree.
- There is no guidance — in the UI or anywhere in the system — for when a reviewer should prefer the trained-model result over the heuristic result or vice versa. When both are shown but neither is explained, the comparison is noise for the reviewer.
- When the two modes disagree significantly (e.g., heuristic says "Independent Solver" at 0.42, trained model says "AI-Dependent Constructor" at 0.38), the policy decision is still driven solely by the `ARCHETYPE_MODE` env var. The disagreement is visible but has no effect on the policy path.

### Reviewer Experience — **Fragile**

The reviewer-web correctly fetches real data from the control plane. The dual scoring cards, integrity flags, top feature drivers, and decision buttons are all functional.

What keeps this from "decent":

- **The timeline shows only 10 events** (`view-model.ts:41`, `eventsResponse.events.slice(0, 10)`). A real coding session produces hundreds or thousands of events. A reviewer inspecting candidate behavior based on 10 events cannot make an informed judgment. This is a hard cap that makes the timeline display essentially decorative.
- The `note` field on `ReviewerDecision` is defined in the contract schema (`packages/contracts/src/types.ts:184`) but is **not exposed anywhere in the reviewer UI**. Reviewers cannot annotate their decisions. The decision record is therefore a bare approve/reject/needs_followup with no audit-useful context.
- There is no explanation of what HACI means relative to any population. A score of 47.6 with no reference range is meaningless to a reviewer who hasn't read the engineering internals.
- Sessions cannot be filtered or sorted in the reviewer panel. The session selector is a raw dropdown with session IDs.
- The "Scoring Provenance" card duplicates information already shown elsewhere on the page. The space would be better used for mode-comparison guidance.

### Admin / Operator Experience — **Misleading / high-risk**

The admin-web fetches real manifests and session data and presents them correctly. The session table with reviewer links works.

The problem is the "Governance Checklist" card, which shows a static bulleted list:

```
- Model version pinning
- Retention policy configuration
- Reviewer assignment workflows
- Audit export controls
```

None of these exist as functional capabilities. This is aspirational HTML masquerading as a product surface. An operator looking at this panel would reasonably infer that these features are accessible through another path. They are not. There is no model pinning UI, no retention configuration, no reviewer assignment workflow, and no audit export anywhere in the codebase.

The admin panel also cannot create sessions (that requires API calls or the desktop controller), cannot modify or delete manifests through the UI, and has no way to trigger a re-score.

### End-to-End Workflow Coherence — **Decent but incomplete**

The happy path works: desktop-controller launches Edge and VS Code, telemetry flows through ingestion-api, the control plane scores on demand, and the reviewer sees real results. This has been validated in practice (`36e6bd86`, `c5ebe45c`).

What's incomplete:

- The `sequence_gap_detected` flag appeared in the human-driven session (`36e6bd86`) on legitimate telemetry. The flag is rule-based (checking for integer sequence gaps per source), and real-world network or ordering variance can trip it. The flag routes sessions to `review` but this behavior is not documented for operators: they cannot tell whether a gap is a telemetry defect or a policy indicator.
- There is no multi-candidate workflow. Every session is single-user, local.
- There is no auth layer. Any request to any API succeeds. CORS is `*` on every endpoint.
- There is no way to re-ingest or correct events after a session ends.

### Local Reliability / Startup — **Decent but incomplete**

One-command startup (`npm run dev:stack:start:full`) works. The replay-fixture regression runs cleanly. The scoring pipeline is deterministic. These are genuine positives.

What's incomplete:

- The difference between `dev:stack` and `dev:stack:start` (with and without `--skip-build`) is non-obvious and the scripts have different behaviors that are easy to confuse.
- The analytics service depends on Python, which requires a separate setup path not managed by `npm`. If the Python environment is wrong, the analytics service silently fails and the control plane returns 502 errors on scoring.
- The trained model artifacts are committed as binary pickle files to the repository. If the `sklearn` or `xgboost` versions in the runtime environment don't match `model_versions.json`, deserialization will fail at runtime.

### Product Readiness vs Research Prototype Maturity — **Strong technical prototype**

This is not an early-stage hack. The engineering is disciplined: Zod contracts are shared, the pipeline is end-to-end, telemetry reaches scoring, reviewer decisions are persisted. But it is also clearly not a product anyone outside this project can operate without engineering support. It requires Windows, a manually configured Python environment, local file storage, and direct API calls to start sessions.

---

## Part 2 — Stability

**What feels production-like:**

- The Zod contract layer. It is rigorous and validates every major payload shape at the API boundary.
- The analytics feature extraction. It is deterministic, well-structured, and the single-fixture regression catches regressions.
- The control plane REST API. The routes are clean, errors are returned correctly, and session state is consistent within a single run.
- The dual-mode scoring architecture. Both modes are computed, the active mode is configurable, and fallback behavior is explicit.

**What still feels prototype-like:**

- File-based storage for everything. Sessions, events, scoring, and decisions are all flat files. This works locally. It does not scale, is not transactional, and has no concurrency protection.
- No authentication on any API endpoint. The ingestion API, control plane, and analytics API all accept unauthenticated requests from any origin.
- The XGBoost model is a committed binary artifact with no documented training pipeline, no versioning strategy, and no upgrade path.
- One fixture backing all analytics regression tests.
- Windows-only live path.

**What is technically working but product-wise weak:**

- HACI. The number is computed correctly and consistently, but 5 hand-tuned signals with unvalidated weights is not a credible "Human-AI Collaboration Index." The name implies scientific rigor that the implementation does not yet have.
- The integrity verdict. The rule set is reasonable but the `sequence_gap_detected` flag triggers on legitimate sessions. Without a documented false-positive rate, operators cannot decide when to trust or override an integrity flag.
- Auto-advance policy. The thresholds are constants in code, not configurable per manifest. The `decision_policy` object in the manifest schema has `auto_advance_min_confidence` (a per-manifest field), but the scoring code ignores it — it uses a hardcoded `0.90` threshold.

**What could break trust even if the UI seems okay:**

- The confidence metric is softmax probability, not calibrated probability. If a reviewer is told a candidate's score is "0.42 confidence — Independent Solver," they may reasonably interpret this as "42% probability of being an Independent Solver." That is not what the number means. At real scale, this distinction matters for the defensibility of assessment outcomes.
- The governance checklist UI implies controls that don't exist. If a product manager or compliance officer demos the admin panel and assumes retention and audit controls are in place, they are wrong.

---

## Part 3 — Gap to Final Vision

**Inferred final vision:** A reliable behavioral assessment platform with strong telemetry-backed scoring, reviewer-facing explainability, trustworthy comparison between scoring modes, a usable human review workflow, and a defensible product surface — not just a strong engine.

### What is already real

- Telemetry collection from multiple sources and its transformation into a structured feature vector.
- An end-to-end scoring pipeline that produces HACI, archetype, integrity verdict, and policy recommendation.
- Dual-mode scoring (heuristic + trained-model) with both results visible to reviewers.
- A reviewer decision workflow with three values (approve/reject/needs_followup) that persists to disk.
- A local one-command stack startup that actually works.

### What is only partially real

- **Reviewer explainability.** The top 5 HACI features are surfaced, but they show raw contribution values with no interpretation guidance. A reviewer seeing `typing_vs_paste_ratio (0.112)` has no frame of reference.
- **Human review workflow.** The reviewer can click three buttons. They cannot annotate, escalate, re-score, or compare a session to historical baselines. The `note` field exists in the schema but is invisible in the UI.
- **Scoring trustworthiness.** The numbers are real outputs of real computation, but neither the weights nor the model have been validated against real candidate behavior.
- **Admin governance.** The admin panel reads real data but offers no governance actions.

### What is still weak or missing

- Authentication and authorization (completely absent).
- Multi-tenant or multi-candidate session management.
- Calibrated scoring — HACI, confidence, and archetype classification are unvalidated against real populations.
- Model explainability — no SHAP values or per-feature contribution from the XGBoost model. The trained model is a black box even to the system that runs it.
- A documented model card for the trained model.
- Audit logging for reviewer decisions.
- Any SaaS deployment path.
- Data retention controls.
- Webhook or export integrations.
- A non-Windows live path.

### Biggest single gap

The scoring outputs — HACI, archetype, confidence — are numbers that look precise but are not calibrated against real candidate behavior. A HACI of 47.6 and "Independent Solver at 0.42 confidence" means nothing outside this codebase. There is no population baseline, no percentile reference, no documented error rate, and no evidence that the archetypes separate meaningfully in practice. This is the gap that prevents a reviewer from trusting the output and the gap that would block any real adoption. A technically impressive pipeline that produces uninterpretable outputs is not a product.

### Current state verdict

**Strong technical prototype.** The engineering discipline is above average for this stage. The architecture is sound. The pipeline is end-to-end. But the gap between "the engine produces outputs" and "a reviewer can trust and act on those outputs" is large, and none of the steps needed to close it (calibration, explainability, audit trail, reviewer tooling) are present in current code.

---

## Part 4 — Brutal Honesty

### Actual strengths

- The 51-signal feature extraction is genuinely solid. The signal catalog, provenance tracking, completeness detection, and the shared JSON schema between Python and TypeScript are clean, maintainable engineering.
- The Zod contract layer is unusually rigorous for a project at this stage. All major API boundaries are validated, and schema drift is caught at parse time.
- The dual-mode scoring architecture (always compute both, ARCHETYPE_MODE selects active) is the right design. It was added cleanly and the reviewer display is correctly implemented.
- The replay-fixture regression prevents silent scoring regressions. It is the most valuable test in the repository.
- Local startup ergonomics are good. The one-command path is real and works.

### Hidden weaknesses

- **The HACI formula is not what it claims to be.** A "Human-AI Collaboration Index" suggests a validated scientific measure. The actual implementation is a linear combination of 5 hand-tuned weights applied to normalized signal values. It has not been validated, is not interpretable to a reviewer, and uses bounds (`max_paste_length` bounded to 2000, `time_to_first_ai_prompt` bounded to 1800 seconds) that were chosen without documented justification.
- **The heuristic archetype formula is unvalidated magic.** The `_bootstrap_archetype_scores()` function applies hand-written formulas like `min(ratio, 8) * 0.35 + min(ai_latency / 600, 3) * 0.20 + ...` with no empirical backing. These weights were not derived from data. Whether they separate archetypes better than random assignment is unknown.
- **The trained model has no documented training provenance.** The artifacts — `archetype_xgboost.pkl`, `feature_scaler.pkl`, `label_encoder.pkl`, `feature_names.pkl` — are committed as binary files. There is no training script, no training data, no confusion matrix, no cross-validation results, and no model card. The model is "research-v1" in name only; it is currently an unauditable black box.
- **The `auto_advance_min_confidence` field in the manifest schema is ignored by the scoring logic.** `scoring.py` hardcodes `confidence >= 0.90` regardless of what the manifest specifies. The manifest field suggests per-assessment policy control that does not actually exist.
- **`sequence_gap_detected` is a real false-positive source.** The human-driven session triggered this flag on legitimate use. Without a way to distinguish a real gap from a network reorder, operators have no principled basis for trusting or overriding this flag.
- **Ingestion has no deduplication.** Events are appended to NDJSON without checking for duplicate `event_id` values. A retry or replay would silently double-count events.

### Demo-looks-good, weak-in-real-use

- **The side-by-side dual scoring display is visually credible** but offers no guidance on when or why to prefer one result over the other. Two confidence numbers without interpretation context are two numbers.
- **The governance checklist in the admin panel creates a false impression of governance capability.** It is static HTML. Any evaluator who sees "Retention policy configuration" in the admin UI and concludes the platform has retention controls would be wrong.
- **The `/health` endpoint reports `trained_model_available: true` and a model version string.** This looks like a production-ready diagnostic surface. The underlying model is a single-run research artifact with no documented quality attributes.
- **The timeline UI would mislead any real reviewer.** The first 10 events of a coding session are almost always session setup events (session.started, browser.navigation to the bootstrap URL, maybe the first IDE event). The substantive behavior — how a candidate actually worked — happens in the events that follow. A reviewer who relies on the timeline display is reviewing the wrong part of the session.

---

## Part 5 — Next-Step Guidance

### Top 3 highest-value next steps

**1. Calibrate and document the scoring outputs against real or realistically labeled data.**

This is the single gap between "engine" and "product." It requires:
- Labeling a set of sessions (even 30–50 manually labeled examples) with ground-truth archetypes.
- Validating whether the heuristic formulas produce archetypes that match ground truth.
- Validating whether the XGBoost model does the same — and if so, documenting accuracy and the training dataset.
- Establishing what HACI bands (high/medium/low) actually mean relative to labeled sessions, so a reviewer can interpret a score of 47.6 as better or worse than the typical candidate.

Without this step, the platform produces precise-looking numbers that no reviewer outside the engineering team can evaluate.

**2. Fix the reviewer workflow gaps that block real use.**

Three specific, small changes:

- Remove the 10-event timeline cap or replace it with a meaningful summary (event type counts by source, or paginated full list).
- Expose the `note` field in the reviewer decision UI. The field already exists in the schema and the storage path. The UI change is minimal.
- Add a simple explanation to the HACI card that contextualizes the score (e.g., "High ≥ 70, Medium 40–69, Low < 40") so a reviewer has a reference without reading the engineering docs.

These changes are small but are the difference between a reviewer workspace that is usable and one that is a visualization exercise.

**3. Write a model card for the trained model and document the auto-advance policy basis.**

Before the trained model can be used in a decision that affects a real candidate, there must be a written record of:
- What data trained it and how it was labeled.
- What accuracy was achieved and on what test set.
- What the model does not generalize to (e.g., non-Python sessions, very short sessions, sessions without browser telemetry).

Additionally, the hardcoded auto-advance thresholds (`confidence >= 0.90`, `haci_score >= 65`) need documented rationale. These constants are currently arbitrary; if they appear in production policy decisions, they must be justified.

### Single best move toward "credible product"

**Calibrate the scoring with real data and document what the output numbers mean.**

The scoring pipeline is functionally complete. The bottleneck is not more features — it is that the outputs are currently uninterpretable to anyone outside the engineering team. A reviewer cannot act on a HACI of 47.6 without knowing what 47.6 means. An organization cannot adopt the platform for real assessments if the scoring basis is undocumented. Even a small, honestly documented set of labeled examples — with the model card and a plain-language HACI interpretation guide — would transform this from a technically impressive prototype into a credible product-in-progress.

---

*This audit is based on the actual code, contracts, tests, and documentation on `main` as of April 16, 2026. No changes were made to the repository as part of this assessment.*
