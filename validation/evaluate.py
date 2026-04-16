#!/usr/bin/env python3
"""
Validation harness for the assessment platform scoring pipeline.

Loads labeled validation sessions from validation/labeled-sessions/,
runs them through the scoring pipeline (both heuristic and trained-model paths),
and computes evaluation metrics:

  - Per-session scoring comparison vs reviewer label
  - Overall accuracy (heuristic and trained model, where available)
  - Class-wise confusion breakdown
  - Dual-mode delta: rate at which heuristic and trained model disagree
  - Short-session bias: accuracy split by session length (< 10 events vs >= 10)

Usage:
    python validation/evaluate.py [--json]

Options:
    --json    Output results as JSON (suitable for machine consumption)

The script must be run from the repository root so that the analytics
package is importable via the standard path used in test_pipeline.py.
"""
from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path

# ---------------------------------------------------------------------------
# Bootstrap the analytics package path (mirrors test_pipeline.py convention).
# ---------------------------------------------------------------------------
REPO_ROOT = Path(__file__).resolve().parents[1]
ANALYTICS_ROOT = REPO_ROOT / "services" / "analytics-py"
if str(ANALYTICS_ROOT) not in sys.path:
    sys.path.insert(0, str(ANALYTICS_ROOT))

try:
    from assessment_analytics.scoring import score_session  # type: ignore[import]
except ImportError as exc:
    print(
        f"ERROR: Could not import assessment_analytics. "
        f"Run this script from the repository root.\n  {exc}",
        file=sys.stderr,
    )
    sys.exit(1)

LABELED_SESSIONS_DIR = REPO_ROOT / "validation" / "labeled-sessions"

# Threshold below which a session is classified as 'short' for bias analysis.
SHORT_SESSION_THRESHOLD = 10


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------

def load_labeled_sessions(directory: Path) -> list[dict]:
    """Load all *.json files from the labeled-sessions directory."""
    sessions = []
    for path in sorted(directory.glob("*.json")):
        with path.open("r", encoding="utf-8") as fh:
            data = json.load(fh)
        if "label" not in data or "events" not in data:
            print(f"  WARNING: {path.name} is missing 'label' or 'events' — skipping.", file=sys.stderr)
            continue
        data["_source_file"] = path.name
        sessions.append(data)
    return sessions


# ---------------------------------------------------------------------------
# Metric helpers
# ---------------------------------------------------------------------------

def _archetype_match(predicted: str, reviewer_label: str) -> bool:
    return predicted.strip().lower() == reviewer_label.strip().lower()


def compute_metrics(results: list[dict]) -> dict:
    """
    Compute aggregate evaluation metrics over a list of per-session result dicts.

    Each result dict is expected to have the keys produced by evaluate_session().
    """
    total = len(results)
    if total == 0:
        return {"error": "No results to evaluate."}

    # --- Accuracy counters ---
    heuristic_correct = 0
    trained_correct = 0
    trained_available = 0

    # --- Dual-mode delta ---
    dual_mode_disagree = 0
    dual_mode_comparable = 0

    # --- Confusion: reviewer_label -> predicted_label -> count ---
    heuristic_confusion: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    trained_confusion: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))

    # --- Short-session bias ---
    short_heuristic_correct = 0
    short_total = 0
    long_heuristic_correct = 0
    long_total = 0

    for r in results:
        reviewer_label = r["reviewer_archetype"]
        h_pred = r["heuristic_predicted"]
        t_pred = r.get("trained_predicted")
        n_events = r["n_events"]
        is_short = n_events < SHORT_SESSION_THRESHOLD

        # Heuristic accuracy
        h_match = _archetype_match(h_pred, reviewer_label)
        if h_match:
            heuristic_correct += 1

        # Heuristic confusion
        heuristic_confusion[reviewer_label][h_pred] += 1

        # Trained model accuracy
        if t_pred is not None:
            trained_available += 1
            t_match = _archetype_match(t_pred, reviewer_label)
            if t_match:
                trained_correct += 1
            trained_confusion[reviewer_label][t_pred] += 1

            # Dual-mode delta
            dual_mode_comparable += 1
            if not _archetype_match(h_pred, t_pred):
                dual_mode_disagree += 1

        # Short-session bias
        if is_short:
            short_total += 1
            if h_match:
                short_heuristic_correct += 1
        else:
            long_total += 1
            if h_match:
                long_heuristic_correct += 1

    def pct(num: int, denom: int) -> float | None:
        return round(num / denom * 100, 1) if denom > 0 else None

    return {
        "total_sessions": total,
        "heuristic_accuracy": {
            "correct": heuristic_correct,
            "total": total,
            "pct": pct(heuristic_correct, total),
        },
        "trained_model_accuracy": {
            "correct": trained_correct,
            "total": trained_available,
            "pct": pct(trained_correct, trained_available),
            "sessions_with_trained_model": trained_available,
        },
        "dual_mode_delta": {
            "disagreements": dual_mode_disagree,
            "comparable_sessions": dual_mode_comparable,
            "disagreement_rate_pct": pct(dual_mode_disagree, dual_mode_comparable),
            "note": (
                "Sessions where heuristic and trained-model predictions differ. "
                "High rates suggest the two modes have meaningfully different behavior."
            ),
        },
        "short_session_bias": {
            "threshold_events": SHORT_SESSION_THRESHOLD,
            "short_sessions": {
                "total": short_total,
                "heuristic_correct": short_heuristic_correct,
                "heuristic_accuracy_pct": pct(short_heuristic_correct, short_total),
            },
            "long_sessions": {
                "total": long_total,
                "heuristic_correct": long_heuristic_correct,
                "heuristic_accuracy_pct": pct(long_heuristic_correct, long_total),
            },
            "note": (
                "Accuracy gap between short (< 10 events) and longer sessions indicates "
                "short-session scoring bias. A low short-session accuracy with Independent Solver "
                "over-representation is a known risk (see integrity.py low_information_session flag)."
            ),
        },
        "heuristic_confusion": {
            "description": "reviewer_label -> heuristic_predicted -> count",
            "matrix": {k: dict(v) for k, v in heuristic_confusion.items()},
        },
        "trained_confusion": {
            "description": "reviewer_label -> trained_predicted -> count (only sessions with trained model output)",
            "matrix": {k: dict(v) for k, v in trained_confusion.items()},
        },
    }


# ---------------------------------------------------------------------------
# Per-session evaluation
# ---------------------------------------------------------------------------

def evaluate_session(labeled: dict) -> dict:
    """Score a single labeled session and compare against the reviewer label."""
    label = labeled["label"]
    session_context = labeled.get("session_context", {})
    events = labeled["events"]
    n_events = len(events)

    scoring = score_session(events, session_context=session_context)

    heuristic_result = scoring.get("heuristic_result") or {}
    trained_result = scoring.get("trained_model_result")

    heuristic_predicted = heuristic_result.get("predicted_archetype", scoring.get("predicted_archetype", ""))
    trained_predicted = trained_result["predicted_archetype"] if trained_result else None

    reviewer_archetype = label.get("reviewer_archetype", "")

    return {
        "session_id": session_context.get("session_id", labeled.get("_source_file", "unknown")),
        "source_file": labeled.get("_source_file", ""),
        "n_events": n_events,
        "is_short_session": n_events < SHORT_SESSION_THRESHOLD,
        "reviewer_archetype": reviewer_archetype,
        "reviewer_confidence": label.get("reviewer_confidence", ""),
        "reviewer_decision": label.get("reviewer_decision", ""),
        "heuristic_predicted": heuristic_predicted,
        "heuristic_confidence": heuristic_result.get("confidence"),
        "heuristic_match": _archetype_match(heuristic_predicted, reviewer_archetype),
        "trained_predicted": trained_predicted,
        "trained_confidence": trained_result["confidence"] if trained_result else None,
        "trained_match": (
            _archetype_match(trained_predicted, reviewer_archetype) if trained_predicted else None
        ),
        "modes_agree": (
            _archetype_match(heuristic_predicted, trained_predicted)
            if trained_predicted is not None
            else None
        ),
        "integrity_verdict": scoring.get("integrity", {}).get("verdict"),
        "integrity_flags": scoring.get("integrity", {}).get("flags", []),
        "haci_score": scoring.get("haci_score"),
        "policy_recommendation": scoring.get("policy_recommendation"),
    }


# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------

def print_human_report(session_results: list[dict], metrics: dict) -> None:
    print("=" * 70)
    print("Assessment Platform — Validation Harness Report")
    print("=" * 70)
    print()

    print("Per-Session Results")
    print("-" * 70)
    header = f"{'Session':<28} {'N':>4} {'Reviewer Label':<28} {'H-Match':>7} {'T-Match':>7}"
    print(header)
    print("-" * 70)
    for r in session_results:
        h_match = "✓" if r["heuristic_match"] else "✗"
        t_raw = r["trained_match"]
        t_match = "✓" if t_raw is True else ("✗" if t_raw is False else "n/a")
        short_tag = " [short]" if r["is_short_session"] else ""
        sid = r["session_id"][:26] + short_tag
        label = r["reviewer_archetype"][:26]
        print(f"  {sid:<28} {r['n_events']:>4} {label:<28} {h_match:>7} {t_match:>7}")
        # Show flags if any integrity concern
        if r["integrity_flags"]:
            print(f"    integrity: {', '.join(r['integrity_flags'])}")
    print()

    print("Accuracy")
    print("-" * 70)
    ha = metrics["heuristic_accuracy"]
    ta = metrics["trained_model_accuracy"]
    print(f"  Heuristic:     {ha['correct']}/{ha['total']}  ({ha['pct']}%)")
    if ta["sessions_with_trained_model"] > 0:
        print(f"  Trained model: {ta['correct']}/{ta['total']}  ({ta['pct']}%)")
    else:
        print("  Trained model: not available (artifacts may not be loaded)")
    print()

    print("Dual-Mode Delta")
    print("-" * 70)
    dm = metrics["dual_mode_delta"]
    print(f"  Disagreements: {dm['disagreements']}/{dm['comparable_sessions']}  ({dm['disagreement_rate_pct']}%)")
    print(f"  Note: {dm['note']}")
    print()

    print("Short-Session Bias")
    print("-" * 70)
    ssb = metrics["short_session_bias"]
    ss = ssb["short_sessions"]
    ls = ssb["long_sessions"]
    print(f"  Threshold: < {ssb['threshold_events']} events")
    print(f"  Short sessions (n={ss['total']}): heuristic accuracy {ss['heuristic_accuracy_pct']}%")
    print(f"  Long sessions  (n={ls['total']}): heuristic accuracy {ls['heuristic_accuracy_pct']}%")
    print(f"  Note: {ssb['note']}")
    print()

    print("Heuristic Confusion (reviewer → predicted)")
    print("-" * 70)
    for reviewer_label, predicted_counts in metrics["heuristic_confusion"]["matrix"].items():
        for predicted, count in sorted(predicted_counts.items(), key=lambda x: -x[1]):
            match_marker = "✓" if reviewer_label.lower() == predicted.lower() else "✗"
            print(f"  {match_marker} reviewer={reviewer_label!r:32s} → heuristic={predicted!r:32s}  n={count}")
    print()

    if metrics["trained_confusion"]["matrix"]:
        print("Trained-Model Confusion (reviewer → predicted)")
        print("-" * 70)
        for reviewer_label, predicted_counts in metrics["trained_confusion"]["matrix"].items():
            for predicted, count in sorted(predicted_counts.items(), key=lambda x: -x[1]):
                match_marker = "✓" if reviewer_label.lower() == predicted.lower() else "✗"
                print(f"  {match_marker} reviewer={reviewer_label!r:32s} → trained={predicted!r:32s}  n={count}")
        print()

    print("Summary")
    print("-" * 70)
    print(f"  Total labeled sessions evaluated: {metrics['total_sessions']}")
    print()
    print("To add more labeled sessions, place *.json files into:")
    print("  validation/labeled-sessions/")
    print("See validation/README.md for the required format.")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    use_json = "--json" in sys.argv

    labeled_sessions = load_labeled_sessions(LABELED_SESSIONS_DIR)
    if not labeled_sessions:
        print(f"ERROR: No labeled sessions found in {LABELED_SESSIONS_DIR}", file=sys.stderr)
        sys.exit(1)

    session_results = []
    for labeled in labeled_sessions:
        try:
            result = evaluate_session(labeled)
            session_results.append(result)
        except Exception as exc:
            source = labeled.get("_source_file", "unknown")
            print(f"  WARNING: Failed to evaluate {source}: {exc}", file=sys.stderr)

    metrics = compute_metrics(session_results)

    if use_json:
        output = {
            "session_results": session_results,
            "metrics": metrics,
        }
        print(json.dumps(output, indent=2))
    else:
        print_human_report(session_results, metrics)


if __name__ == "__main__":
    main()
