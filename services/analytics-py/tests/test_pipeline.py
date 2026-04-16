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


if __name__ == "__main__":
    unittest.main()