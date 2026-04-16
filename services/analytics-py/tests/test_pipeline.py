from __future__ import annotations

import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

PACKAGE_ROOT = Path(__file__).resolve().parents[1]
if str(PACKAGE_ROOT) not in sys.path:
    sys.path.insert(0, str(PACKAGE_ROOT))

from assessment_analytics.catalog import SIGNAL_NAMES
from assessment_analytics.features import extract_feature_vector
from assessment_analytics.integrity import evaluate_integrity
from assessment_analytics.scoring import score_session


FIXTURE_PATH = Path(__file__).resolve().parents[3] / "fixtures" / "sample-session.json"

def _assert_probability_distribution(testcase: unittest.TestCase, probabilities: dict) -> None:
    testcase.assertEqual(len(probabilities), 7)
    probability_sum = sum(probabilities.values())
    testcase.assertAlmostEqual(probability_sum, 1.0, places=2)


class AnalyticsPipelineTests(unittest.TestCase):
    def setUp(self) -> None:
        with FIXTURE_PATH.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)
        self.session_context = payload["session_context"]
        self.events = payload["events"]

    # ------------------------------------------------------------------
    # Helper used by the decision-policy threshold tests.
    # ------------------------------------------------------------------
    MOCK_CLEAN_INTEGRITY: dict = {
        "verdict": "clean",
        "flags": [],
        "missing_streams": [],
        "required_streams_present": ["desktop", "ide"],
        "invalidation_reasons": [],
        "haci_score": None,
        "predicted_archetype": None,
    }

    def _score_with_clean_integrity_high_haci(self, session_context: dict) -> dict:
        """Reload scoring in heuristic mode, mock clean integrity and high HACI, then score."""
        # importlib.reload is used inside the method so that each call re-evaluates
        # ARCHETYPE_MODE from the environment, resetting any state left by previous tests.
        import importlib
        import assessment_analytics.scoring as scoring

        with patch.dict("os.environ", {}, clear=True):
            importlib.reload(scoring)
            with (
                patch("assessment_analytics.scoring.evaluate_integrity", return_value=self.MOCK_CLEAN_INTEGRITY),
                patch("assessment_analytics.scoring._compute_haci", return_value=(70.0, [])),
            ):
                return scoring.score_session(self.events, session_context)

    def test_feature_vector_contains_all_51_signals(self) -> None:
        feature_vector = extract_feature_vector(self.events, self.session_context)
        self.assertEqual(len(feature_vector["signals"]), 51)
        self.assertEqual(set(feature_vector["signal_values"].keys()), set(SIGNAL_NAMES))
        self.assertGreater(feature_vector["signal_values"]["session_duration"], 0)
        self.assertGreaterEqual(feature_vector["signal_values"]["total_prompts_sent"], 2)

    def test_integrity_evaluates_required_streams(self) -> None:
        feature_vector = extract_feature_vector(self.events, self.session_context)
        integrity = evaluate_integrity(self.events, feature_vector, self.session_context)
        self.assertIn(integrity["verdict"], {"clean", "review", "invalid"})
        self.assertEqual(integrity["missing_streams"], [])

    def test_integrity_allows_managed_bootstrap_navigation(self) -> None:
        session_context = {
            "required_streams": ["desktop", "ide", "browser"],
            "allowed_sites": ["developer.mozilla.org"],
            "allowed_ai_providers": ["openai"],
        }
        events = [
            {
                "event_id": "desktop-1",
                "session_id": "session-1",
                "timestamp_utc": "2026-04-14T05:00:00Z",
                "source": "desktop",
                "event_type": "session.started",
                "sequence_no": 1,
                "artifact_ref": "session",
                "payload": {"status": "active"},
                "client_version": "0.1.0",
                "integrity_hash": "hash-1",
                "policy_context": {"managed_session": True},
            },
            {
                "event_id": "browser-1",
                "session_id": "session-1",
                "timestamp_utc": "2026-04-14T05:00:01Z",
                "source": "browser",
                "event_type": "browser.navigation",
                "sequence_no": 1,
                "artifact_ref": "tab:1",
                "payload": {
                    "url": "http://127.0.0.1:4010/browser-bootstrap?sessionId=session-1",
                    "domain": "127.0.0.1",
                    "managed_bootstrap": True,
                    "allowed_site": True,
                },
                "client_version": "0.1.0",
                "integrity_hash": "hash-2",
                "policy_context": {"managed_session": True},
            },
            {
                "event_id": "ide-1",
                "session_id": "session-1",
                "timestamp_utc": "2026-04-14T05:00:02Z",
                "source": "ide",
                "event_type": "ide.extension.activated",
                "sequence_no": 1,
                "artifact_ref": "extension:assessment-platform",
                "payload": {"mode": "injected"},
                "client_version": "0.1.0",
                "integrity_hash": "hash-3",
                "policy_context": {"managed_session": True},
            },
            {
                "event_id": "desktop-2",
                "session_id": "session-1",
                "timestamp_utc": "2026-04-14T05:00:03Z",
                "source": "desktop",
                "event_type": "session.heartbeat",
                "sequence_no": 2,
                "artifact_ref": "session",
                "payload": {"status": "active"},
                "client_version": "0.1.0",
                "integrity_hash": "hash-4",
                "policy_context": {"managed_session": True},
            },
        ]

        feature_vector = extract_feature_vector(events, session_context)
        integrity = evaluate_integrity(events, feature_vector, session_context)

        self.assertNotIn("unsupported_site_visited", integrity["flags"])
        self.assertNotIn("low_information_session", integrity["flags"])
        self.assertEqual(integrity["verdict"], "clean")

    def test_integrity_flags_explicitly_unsupported_browser_navigation(self) -> None:
        session_context = {
            "required_streams": ["desktop", "ide", "browser"],
            "allowed_sites": ["developer.mozilla.org"],
            "allowed_ai_providers": ["openai"],
        }
        events = [
            {
                "event_id": "desktop-1",
                "session_id": "session-2",
                "timestamp_utc": "2026-04-14T05:01:00Z",
                "source": "desktop",
                "event_type": "session.started",
                "sequence_no": 1,
                "artifact_ref": "session",
                "payload": {"status": "active"},
                "client_version": "0.1.0",
                "integrity_hash": "hash-1",
                "policy_context": {"managed_session": True},
            },
            {
                "event_id": "browser-1",
                "session_id": "session-2",
                "timestamp_utc": "2026-04-14T05:01:01Z",
                "source": "browser",
                "event_type": "browser.navigation",
                "sequence_no": 1,
                "artifact_ref": "tab:1",
                "payload": {
                    "url": "https://example.com/",
                    "domain": "example.com",
                    "managed_bootstrap": False,
                    "allowed_site": False,
                },
                "client_version": "0.1.0",
                "integrity_hash": "hash-2",
                "policy_context": {"managed_session": True},
            },
            {
                "event_id": "ide-1",
                "session_id": "session-2",
                "timestamp_utc": "2026-04-14T05:01:02Z",
                "source": "ide",
                "event_type": "ide.extension.activated",
                "sequence_no": 1,
                "artifact_ref": "extension:assessment-platform",
                "payload": {"mode": "injected"},
                "client_version": "0.1.0",
                "integrity_hash": "hash-3",
                "policy_context": {"managed_session": True},
            },
            {
                "event_id": "desktop-2",
                "session_id": "session-2",
                "timestamp_utc": "2026-04-14T05:01:03Z",
                "source": "desktop",
                "event_type": "session.heartbeat",
                "sequence_no": 2,
                "artifact_ref": "session",
                "payload": {"status": "active"},
                "client_version": "0.1.0",
                "integrity_hash": "hash-4",
                "policy_context": {"managed_session": True},
            },
        ]

        feature_vector = extract_feature_vector(events, session_context)
        integrity = evaluate_integrity(events, feature_vector, session_context)

        self.assertIn("unsupported_site_visited", integrity["flags"])
        self.assertEqual(integrity["verdict"], "review")

    def test_scoring_defaults_to_heuristic_mode(self) -> None:
        with patch.dict("os.environ", {}, clear=True):
            import importlib
            import assessment_analytics.scoring as scoring

            importlib.reload(scoring)
            result = scoring.score_session(self.events, self.session_context)

        self.assertEqual(result["scoring_mode"], "heuristic")
        self.assertEqual(result["model_version"], "bootstrap-centroid-v1")
        _assert_probability_distribution(self, result["archetype_probabilities"])
        self.assertIn(result["predicted_archetype"], result["archetype_probabilities"])

    def test_scoring_always_includes_heuristic_result(self) -> None:
        with patch.dict("os.environ", {}, clear=True):
            import importlib
            import assessment_analytics.scoring as scoring

            importlib.reload(scoring)
            result = scoring.score_session(self.events, self.session_context)

        self.assertIn("heuristic_result", result)
        hr = result["heuristic_result"]
        self.assertEqual(hr["scoring_mode"], "heuristic")
        self.assertEqual(hr["model_version"], "bootstrap-centroid-v1")
        _assert_probability_distribution(self, hr["archetype_probabilities"])
        self.assertIn(hr["predicted_archetype"], hr["archetype_probabilities"])
        self.assertGreater(hr["confidence"], 0.0)

    def test_scoring_includes_trained_model_result_when_artifacts_available(self) -> None:
        with patch.dict("os.environ", {"ARCHETYPE_MODE": "trained_model"}, clear=True):
            import importlib
            import assessment_analytics.scoring as scoring

            importlib.reload(scoring)
            result = scoring.score_session(self.events, self.session_context)

        self.assertIn("trained_model_result", result)
        tmr = result["trained_model_result"]
        if tmr is not None:
            self.assertEqual(tmr["scoring_mode"], "trained_model")
            self.assertEqual(tmr["model_version"], "xgboost-research-v1")
            _assert_probability_distribution(self, tmr["archetype_probabilities"])
            self.assertIn(tmr["predicted_archetype"], tmr["archetype_probabilities"])
            self.assertGreater(tmr["confidence"], 0.0)

    def test_scoring_trained_model_result_is_none_when_artifacts_unavailable(self) -> None:
        with patch.dict("os.environ", {"ARCHETYPE_MODE": "trained_model"}, clear=True):
            import importlib
            import assessment_analytics.scoring as scoring

            importlib.reload(scoring)
            with patch.object(scoring, "ARTIFACTS_DIR", Path("/nonexistent")):
                scoring._MODEL_BUNDLE = None
                scoring._MODEL_LOAD_ERROR = None
                result = scoring.score_session(self.events, self.session_context)

        self.assertIsNone(result["trained_model_result"])
        self.assertIsNotNone(result["heuristic_result"])

    def test_scoring_supports_trained_model_mode(self) -> None:
        with patch.dict("os.environ", {"ARCHETYPE_MODE": "trained_model"}, clear=True):
            import importlib
            import assessment_analytics.scoring as scoring

            importlib.reload(scoring)
            result = scoring.score_session(self.events, self.session_context)

        self.assertEqual(result["scoring_mode"], "trained_model")
        self.assertEqual(result["model_version"], "xgboost-research-v1")
        _assert_probability_distribution(self, result["archetype_probabilities"])
        self.assertIn(result["predicted_archetype"], result["archetype_probabilities"])

    def test_scoring_falls_back_to_heuristic_when_artifacts_unavailable(self) -> None:
        with patch.dict("os.environ", {"ARCHETYPE_MODE": "trained_model"}, clear=True):
            import importlib
            import assessment_analytics.scoring as scoring

            importlib.reload(scoring)
            with patch.object(scoring, "ARTIFACTS_DIR", Path("/nonexistent")):
                scoring._MODEL_BUNDLE = None
                scoring._MODEL_LOAD_ERROR = None
                result = scoring.score_session(self.events, self.session_context)

        self.assertEqual(result["scoring_mode"], "heuristic")
        self.assertEqual(result["model_version"], "bootstrap-centroid-v1")

    def test_policy_default_threshold_applied_when_no_decision_policy(self) -> None:
        """Default auto-advance threshold (0.90) is used when decision_policy is absent."""
        # Fixture heuristic confidence is well below 0.90 (~0.18). With clean integrity
        # and HACI >= 65, only the confidence gate determines the recommendation.
        result = self._score_with_clean_integrity_high_haci(self.session_context)

        # Actual fixture heuristic confidence < 0.90 → default threshold not met → human-review
        self.assertLess(result["confidence"], 0.90)
        self.assertEqual(result["policy_recommendation"], "human-review")
        self.assertTrue(result["review_required"])

    def test_policy_override_lowers_auto_advance_threshold(self) -> None:
        """When decision_policy.auto_advance_min_confidence is set lower, it replaces the default."""
        # Set threshold below the fixture heuristic confidence (~0.18) so auto-advance triggers.
        context_with_policy = {
            **self.session_context,
            "decision_policy": {"auto_advance_min_confidence": 0.10},
        }
        result = self._score_with_clean_integrity_high_haci(context_with_policy)

        # Fixture confidence > 0.10 override → auto-advance
        self.assertGreater(result["confidence"], 0.10)
        self.assertEqual(result["policy_recommendation"], "auto-advance")
        self.assertFalse(result["review_required"])

    def test_policy_override_raises_threshold_above_session_confidence(self) -> None:
        """When decision_policy sets a higher threshold, stricter check blocks auto-advance."""
        # Set threshold above the fixture heuristic confidence (~0.18) so auto-advance fails.
        context_with_strict_policy = {
            **self.session_context,
            "decision_policy": {"auto_advance_min_confidence": 0.95},
        }
        result = self._score_with_clean_integrity_high_haci(context_with_strict_policy)

        # Fixture confidence < 0.95 strict override → human-review
        self.assertLess(result["confidence"], 0.95)
        self.assertEqual(result["policy_recommendation"], "human-review")
        self.assertTrue(result["review_required"])

    def test_haci_is_stable_across_scoring_modes(self) -> None:
        with patch.dict("os.environ", {}, clear=True):
            import importlib
            import assessment_analytics.scoring as scoring

            importlib.reload(scoring)
            heuristic_result = scoring.score_session(self.events, self.session_context)

        with patch.dict("os.environ", {"ARCHETYPE_MODE": "trained_model"}, clear=True):
            import importlib
            import assessment_analytics.scoring as scoring

            importlib.reload(scoring)
            trained_result = scoring.score_session(self.events, self.session_context)

        self.assertEqual(heuristic_result["haci_score"], trained_result["haci_score"])


def _make_short_session_events(event_count: int, typed_chars: int = 0) -> list[dict]:
    """Build a minimal event list for short-session tests.

    The first two events are always session.started (desktop) and
    session.heartbeat (desktop).  Additional events up to *event_count* are
    ide.document.changed events that insert *typed_chars* characters each.
    All events belong to the same session and are spaced 5 seconds apart.
    """
    base_ts = "2026-04-14T06:00:{:02d}Z"
    events = [
        {
            "event_id": "desktop-1",
            "session_id": "short-session-1",
            "timestamp_utc": base_ts.format(0),
            "source": "desktop",
            "event_type": "session.started",
            "sequence_no": 1,
            "artifact_ref": "session",
            "payload": {"status": "active"},
            "client_version": "0.1.0",
            "integrity_hash": "h1",
            "policy_context": {},
        },
        {
            "event_id": "desktop-2",
            "session_id": "short-session-1",
            "timestamp_utc": base_ts.format(5),
            "source": "desktop",
            "event_type": "session.heartbeat",
            "sequence_no": 2,
            "artifact_ref": "session",
            "payload": {"status": "active"},
            "client_version": "0.1.0",
            "integrity_hash": "h2",
            "policy_context": {},
        },
    ]
    for index in range(event_count - 2):
        events.append({
            "event_id": f"ide-{index + 1}",
            "session_id": "short-session-1",
            "timestamp_utc": base_ts.format(10 + index * 5),
            "source": "ide",
            "event_type": "ide.document.changed",
            "sequence_no": index + 1,
            "artifact_ref": "file:main.py",
            "payload": {
                "inserted_chars": typed_chars,
                "deleted_chars": 0,
                "change_source": "typing",
            },
            "client_version": "0.1.0",
            "integrity_hash": f"h-ide-{index + 1}",
            "policy_context": {},
        })
    return events


class ShortSessionTests(unittest.TestCase):
    """Regression tests for sparse-telemetry / low-information sessions."""

    _SESSION_CONTEXT = {
        "required_streams": ["desktop", "ide"],
    }

    # ------------------------------------------------------------------
    # Integrity flag tests
    # ------------------------------------------------------------------

    def test_short_session_without_sparse_signature_is_not_flagged_low_information(self) -> None:
        """Short sessions are not flagged unless they match the known sparse signature."""
        events = _make_short_session_events(event_count=4)
        feature_vector = extract_feature_vector(events, self._SESSION_CONTEXT)
        integrity = evaluate_integrity(events, feature_vector, self._SESSION_CONTEXT)

        self.assertNotIn("low_information_session", integrity["flags"])
        self.assertEqual(integrity["verdict"], "clean")

    def test_sparse_signature_without_ai_or_paste_gets_low_information_flag(self) -> None:
        """Low-information flag is grounded to the known short typing-only sparse pattern."""
        events = _make_short_session_events(event_count=4, typed_chars=20)
        feature_vector = extract_feature_vector(events, self._SESSION_CONTEXT)
        integrity = evaluate_integrity(events, feature_vector, self._SESSION_CONTEXT)

        self.assertIn("low_information_session", integrity["flags"])
        self.assertEqual(integrity["verdict"], "review")
        self.assertTrue(any("insufficient behavioral signal" in note for note in integrity["notes"]))

    # ------------------------------------------------------------------
    # Scoring bias documentation tests
    # ------------------------------------------------------------------

    def test_sparse_session_with_typing_produces_high_independent_solver_confidence(self) -> None:
        """Documents the known heuristic bias: a short session with a few typed
        chars and no paste/AI activity yields a high-confidence Independent
        Solver label due to typing_vs_paste_ratio being computed as raw typed
        character count when no paste events are present.

        This test CONFIRMS the bias and the low_information_session flag is the
        mitigation.  The label should be treated as indicative only.
        """
        events = _make_short_session_events(event_count=4, typed_chars=20)
        result = score_session(events, self._SESSION_CONTEXT)

        # Bias confirmed: Independent Solver wins at high confidence.
        self.assertEqual(result["heuristic_result"]["predicted_archetype"], "Independent Solver")
        self.assertGreater(result["heuristic_result"]["confidence"], 0.50)

        # Mitigation confirmed: integrity flags the low-information condition.
        self.assertIn("low_information_session", result["integrity"]["flags"])

        # Policy confirmed: sparse session requires human review (cannot auto-advance).
        self.assertEqual(result["policy_recommendation"], "human-review")
        self.assertTrue(result["review_required"])

    def test_sparse_session_always_requires_human_review(self) -> None:
        """Even if a sparse session somehow satisfies the confidence threshold,
        the low_information_session integrity flag keeps verdict at 'review',
        blocking auto-advance policy."""
        events = _make_short_session_events(event_count=4, typed_chars=20)
        # Use a very permissive policy override so that confidence alone would
        # allow auto-advance.
        context = {**self._SESSION_CONTEXT, "decision_policy": {"auto_advance_min_confidence": 0.10}}
        result = score_session(events, context)

        # Despite the permissive threshold, the integrity review verdict and the
        # absence of a clean integrity verdict prevent auto-advance.
        self.assertNotEqual(result["policy_recommendation"], "auto-advance")
        self.assertTrue(result["review_required"])


if __name__ == "__main__":
    unittest.main()


# ==========================================================================
# Audit hardening tests added during end-to-end stability audit
# ==========================================================================


class EdgeCaseAndRegressionTests(unittest.TestCase):
    """Regression and edge-case tests for the analytics pipeline.

    Covers: empty-event sessions, null context, all integrity flags,
    invalid ARCHETYPE_MODE fallback, and heuristic-result guarantee.
    """

    _BASE_EVENT_TEMPLATE = {
        "event_id": "e-{n}",
        "session_id": "audit-session",
        "timestamp_utc": "2026-04-14T10:00:{n:02d}Z",
        "source": "desktop",
        "event_type": "session.heartbeat",
        "sequence_no": 1,
        "artifact_ref": "session",
        "payload": {"status": "active"},
        "client_version": "0.1.0",
        "integrity_hash": "h",
        "policy_context": {},
    }

    # ------------------------------------------------------------------
    # Empty / null inputs
    # ------------------------------------------------------------------

    def test_empty_events_list_raises_value_error(self) -> None:
        """score_session raises ValueError for empty events (documented limitation).

        Follow-up risk: callers must guard against empty event lists before
        calling score_session; the API surface does not handle this gracefully.
        """
        with self.assertRaises(ValueError, msg="empty events should raise ValueError"):
            score_session([], {"required_streams": ["desktop", "ide"]})

    def test_none_session_context_produces_valid_scoring_output(self) -> None:
        """score_session must not crash when session_context is None."""
        events = [
            {
                "event_id": "d1",
                "session_id": "ctx-none",
                "timestamp_utc": "2026-04-14T10:00:00Z",
                "source": "desktop",
                "event_type": "session.started",
                "sequence_no": 1,
                "artifact_ref": "session",
                "payload": {"status": "active"},
                "client_version": "0.1.0",
                "integrity_hash": "h1",
                "policy_context": {},
            }
        ]
        result = score_session(events, None)
        self.assertIn("scoring_mode", result)
        self.assertIn("heuristic_result", result)
        self.assertIsNotNone(result["heuristic_result"])

    # ------------------------------------------------------------------
    # Invalid ARCHETYPE_MODE env var
    # ------------------------------------------------------------------

    def test_invalid_archetype_mode_env_falls_back_to_heuristic(self) -> None:
        """An unrecognised ARCHETYPE_MODE must fall back to heuristic, not crash."""
        with patch.dict("os.environ", {"ARCHETYPE_MODE": "not_a_real_mode"}, clear=True):
            import importlib
            import assessment_analytics.scoring as scoring_module
            importlib.reload(scoring_module)
            self.assertEqual(scoring_module.ARCHETYPE_MODE, "heuristic")

    # ------------------------------------------------------------------
    # Individual integrity flags
    # ------------------------------------------------------------------

    def _make_event(self, *, source: str, event_type: str, seq: int, payload: dict | None = None) -> dict:
        return {
            "event_id": f"{source}-{seq}",
            "session_id": "audit-session",
            "timestamp_utc": f"2026-04-14T10:00:{seq:02d}Z",
            "source": source,
            "event_type": event_type,
            "sequence_no": seq,
            "artifact_ref": "session",
            "payload": payload or {},
            "client_version": "0.1.0",
            "integrity_hash": f"h-{seq}",
            "policy_context": {},
        }

    def test_telemetry_heartbeat_missing_flag_when_desktop_has_no_heartbeat(self) -> None:
        """When desktop events are present but no heartbeat, the flag is raised."""
        events = [
            self._make_event(source="desktop", event_type="session.started", seq=1),
        ]
        feature_vector = extract_feature_vector(events, {"required_streams": ["desktop"]})
        integrity = evaluate_integrity(events, feature_vector, {"required_streams": ["desktop"]})
        self.assertIn("telemetry_heartbeat_missing", integrity["flags"])
        self.assertEqual(integrity["verdict"], "review")

    def test_suspicious_bulk_paste_flag_triggered(self) -> None:
        """max_paste_length >= 2000 from ide.clipboard.paste must raise suspicious_bulk_paste."""
        events = [
            self._make_event(source="desktop", event_type="session.started", seq=1),
            self._make_event(source="desktop", event_type="session.heartbeat", seq=2),
            {
                "event_id": "ide-1",
                "session_id": "audit-session",
                "timestamp_utc": "2026-04-14T10:00:03Z",
                "source": "ide",
                "event_type": "ide.clipboard.paste",
                "sequence_no": 1,
                "artifact_ref": "file:main.py",
                "payload": {
                    "pasted_chars": 2500,
                },
                "client_version": "0.1.0",
                "integrity_hash": "h-ide",
                "policy_context": {},
            },
        ]
        ctx = {"required_streams": ["desktop", "ide"]}
        feature_vector = extract_feature_vector(events, ctx)
        integrity = evaluate_integrity(events, feature_vector, ctx)
        self.assertIn("suspicious_bulk_paste", integrity["flags"])
        self.assertEqual(integrity["verdict"], "review")

    def test_unmanaged_tool_flag_raised_on_system_event(self) -> None:
        """system.unmanaged_tool.detected must raise unmanaged_tool_detected."""
        events = [
            self._make_event(source="desktop", event_type="session.started", seq=1),
            self._make_event(source="desktop", event_type="session.heartbeat", seq=2),
            self._make_event(source="desktop", event_type="system.unmanaged_tool.detected", seq=3),
        ]
        ctx = {"required_streams": ["desktop"]}
        feature_vector = extract_feature_vector(events, ctx)
        integrity = evaluate_integrity(events, feature_vector, ctx)
        self.assertIn("unmanaged_tool_detected", integrity["flags"])
        self.assertEqual(integrity["verdict"], "review")

    def test_tamper_signal_detected_makes_verdict_invalid(self) -> None:
        """system.tamper.detected must set verdict to invalid."""
        events = [
            self._make_event(source="desktop", event_type="session.started", seq=1),
            self._make_event(source="desktop", event_type="session.heartbeat", seq=2),
            self._make_event(source="desktop", event_type="system.tamper.detected", seq=3),
        ]
        ctx = {"required_streams": ["desktop"]}
        feature_vector = extract_feature_vector(events, ctx)
        integrity = evaluate_integrity(events, feature_vector, ctx)
        self.assertIn("tamper_signal_detected", integrity["flags"])
        self.assertEqual(integrity["verdict"], "invalid")

    def test_unmanaged_browser_flag_makes_verdict_invalid(self) -> None:
        """system.browser.unmanaged must set verdict to invalid."""
        events = [
            self._make_event(source="desktop", event_type="session.started", seq=1),
            self._make_event(source="desktop", event_type="session.heartbeat", seq=2),
            self._make_event(source="desktop", event_type="system.browser.unmanaged", seq=3),
        ]
        ctx = {"required_streams": ["desktop"]}
        feature_vector = extract_feature_vector(events, ctx)
        integrity = evaluate_integrity(events, feature_vector, ctx)
        self.assertIn("unmanaged_browser_detected", integrity["flags"])
        self.assertEqual(integrity["verdict"], "invalid")

    def test_unsupported_ai_provider_flag(self) -> None:
        """AI prompt from a disallowed provider must raise unsupported_ai_provider."""
        events = [
            self._make_event(source="desktop", event_type="session.started", seq=1),
            self._make_event(source="desktop", event_type="session.heartbeat", seq=2),
            {
                "event_id": "browser-1",
                "session_id": "audit-session",
                "timestamp_utc": "2026-04-14T10:00:03Z",
                "source": "browser",
                "event_type": "browser.ai.prompt",
                "sequence_no": 1,
                "artifact_ref": "provider:unknown-ai",
                "payload": {"provider": "unknown-ai"},
                "client_version": "0.1.0",
                "integrity_hash": "h-browser",
                "policy_context": {},
            },
        ]
        ctx = {
            "required_streams": ["desktop", "browser"],
            "allowed_ai_providers": ["openai"],
        }
        feature_vector = extract_feature_vector(events, ctx)
        integrity = evaluate_integrity(events, feature_vector, ctx)
        self.assertIn("unsupported_ai_provider", integrity["flags"])
        self.assertEqual(integrity["verdict"], "review")

    def test_sequence_gap_detected_flag(self) -> None:
        """Out-of-order sequence numbers for a source must raise sequence_gap_detected."""
        events = [
            self._make_event(source="desktop", event_type="session.started", seq=1),
            self._make_event(source="desktop", event_type="session.heartbeat", seq=2),
            # Jump to sequence 5, skipping 3 and 4
            {
                **self._make_event(source="desktop", event_type="session.heartbeat", seq=5),
                "sequence_no": 5,
            },
        ]
        ctx = {"required_streams": ["desktop"]}
        feature_vector = extract_feature_vector(events, ctx)
        integrity = evaluate_integrity(events, feature_vector, ctx)
        self.assertIn("sequence_gap_detected", integrity["flags"])
        self.assertEqual(integrity["verdict"], "review")

    # ------------------------------------------------------------------
    # Policy passthrough and scoring completeness
    # ------------------------------------------------------------------

    def test_score_session_always_returns_heuristic_result_not_none(self) -> None:
        """heuristic_result must never be None when events are non-empty."""
        results = [
            score_session(
                [self._make_event(source="desktop", event_type="session.started", seq=1)],
                {"required_streams": ["desktop"]},
            ),
            score_session(
                [
                    self._make_event(source="desktop", event_type="session.started", seq=1),
                    self._make_event(source="desktop", event_type="session.heartbeat", seq=2),
                ],
                None,
            ),
        ]
        for result in results:
            self.assertIsNotNone(result.get("heuristic_result"))
            self.assertEqual(result["heuristic_result"]["scoring_mode"], "heuristic")

    def test_auto_reject_enabled_field_is_passed_through_in_context(self) -> None:
        """decision_policy.auto_reject_enabled is accepted without error (policy passthrough)."""
        from pathlib import Path
        from unittest.mock import patch as mpatch
        import importlib
        import assessment_analytics.scoring as scoring_module

        ctx = {
            "required_streams": ["desktop", "ide"],
            "decision_policy": {
                "auto_advance_min_confidence": 0.90,
                "auto_reject_enabled": False,
                "require_full_completeness": True,
            },
        }
        # Score with full fixture events to ensure policy is evaluated.
        with mpatch.dict("os.environ", {}, clear=True):
            importlib.reload(scoring_module)
            with (
                mpatch("assessment_analytics.scoring.evaluate_integrity", return_value={
                    "verdict": "clean",
                    "flags": [],
                    "missing_streams": [],
                    "required_streams_present": ["desktop", "ide"],
                    "invalidation_reasons": [],
                    "notes": [],
                }),
                mpatch("assessment_analytics.scoring._compute_haci", return_value=(50.0, [])),
            ):
                result = scoring_module.score_session(
                    [self._make_event(source="desktop", event_type="session.started", seq=1)],
                    ctx,
                )
        # Must not raise; result must include standard fields.
        self.assertIn("policy_recommendation", result)
        self.assertIn("review_required", result)
