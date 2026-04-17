"""
Integrity and scoring edge-case tests for the analytics pipeline.

Covers:
 - Empty event list → all streams missing when passed directly to evaluate_integrity
 - Tamper signal detected → verdict=invalid regardless of other flags
 - Unmanaged browser detected → verdict=invalid
 - Sequence gap detection → sequence_gap_detected flag, verdict=review
 - Suspicious bulk-paste flag (max_paste_length >= 2000)
 - Excessive focus switching flag (focus_switch_count >= 30)
 - Unsupported AI provider flag
 - Unsupported site visited flag (allowed_site=None, not in allowed_sites)
 - Multiple "review" flags still yield verdict=review (not invalid)
 - Decision policy: confidence above vs below threshold
 - Decision policy: invalid integrity overrides policy even at low threshold
 - HACI score is clamped to [0, 100]
 - score_session output always contains all required top-level keys
 - score_session with minimal events does not crash
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

PACKAGE_ROOT = Path(__file__).resolve().parents[1]
if str(PACKAGE_ROOT) not in sys.path:
    sys.path.insert(0, str(PACKAGE_ROOT))

from assessment_analytics.features import extract_feature_vector
from assessment_analytics.integrity import evaluate_integrity
from assessment_analytics.scoring import score_session


# ---------------------------------------------------------------------------
# Minimal event factory
# ---------------------------------------------------------------------------

def _make_event(
    session_id: str,
    source: str,
    event_type: str,
    seq: int,
    payload: dict | None = None,
    ts_offset: int = 0,
) -> dict:
    return {
        "event_id": f"{source}-{seq}",
        "session_id": session_id,
        "timestamp_utc": f"2026-04-15T08:00:{ts_offset:02d}Z",
        "source": source,
        "event_type": event_type,
        "sequence_no": seq,
        "artifact_ref": "session",
        "payload": payload or {},
        "client_version": "0.1.0",
        "integrity_hash": f"h-{source}-{seq}",
        "policy_context": {},
    }


def _minimal_valid_events(session_id: str = "s1") -> list[dict]:
    """A minimal event list that satisfies desktop+ide requirements."""
    return [
        _make_event(session_id, "desktop", "session.started", 1, ts_offset=0),
        _make_event(session_id, "desktop", "session.heartbeat", 2, ts_offset=5),
        _make_event(session_id, "ide", "ide.extension.activated", 1, ts_offset=2),
    ]


def _empty_feature_vector(session_id: str = "s-empty") -> dict:
    """A minimal synthetic feature_vector usable when there are no real events.

    This avoids calling extract_feature_vector (which raises for empty lists)
    while still allowing evaluate_integrity to be called directly.
    """
    return {
        "session_id": session_id,
        "signal_values": {
            "total_insert_events": 0.0,
            "total_paste_events": 0.0,
            "total_prompts_sent": 0.0,
            "max_paste_length": 0.0,
            "focus_switch_count": 0.0,
            "idle_ratio": 0.0,
        },
    }


# ---------------------------------------------------------------------------
# Integrity: empty event list (tested via evaluate_integrity directly)
# ---------------------------------------------------------------------------

class EmptyEventListTests(unittest.TestCase):

    def test_empty_events_missing_all_required_streams(self) -> None:
        """An empty event list produces missing_streams for all required streams."""
        context = {"required_streams": ["desktop", "ide"]}
        fv = _empty_feature_vector()
        integrity = evaluate_integrity([], fv, context)

        self.assertEqual(sorted(integrity["missing_streams"]), ["desktop", "ide"])
        self.assertIn("missing_required_streams", integrity["flags"])
        self.assertEqual(integrity["verdict"], "invalid")

    def test_empty_events_with_no_required_streams_is_clean(self) -> None:
        """If no streams are required, an empty event list can be clean."""
        context = {"required_streams": []}
        fv = _empty_feature_vector()
        integrity = evaluate_integrity([], fv, context)

        self.assertEqual(integrity["missing_streams"], [])
        self.assertNotIn("missing_required_streams", integrity["flags"])
        self.assertEqual(integrity["verdict"], "clean")

    def test_extract_feature_vector_raises_for_empty_event_list(self) -> None:
        """extract_feature_vector raises ValueError when given an empty event list."""
        with self.assertRaises(ValueError):
            extract_feature_vector([])


# ---------------------------------------------------------------------------
# Integrity: tamper and unmanaged-browser → verdict=invalid
# ---------------------------------------------------------------------------

class InvalidVerdictFlagTests(unittest.TestCase):
    """Flags that should unconditionally produce verdict=invalid."""

    _CONTEXT = {"required_streams": ["desktop"]}

    def _base_events(self, session_id: str = "s-inv") -> list[dict]:
        return [
            _make_event(session_id, "desktop", "session.started", 1, ts_offset=0),
            _make_event(session_id, "desktop", "session.heartbeat", 2, ts_offset=5),
        ]

    def test_tamper_signal_produces_invalid_verdict(self) -> None:
        events = self._base_events() + [
            _make_event("s-inv", "system", "system.tamper.detected", 1, ts_offset=10)
        ]
        fv = extract_feature_vector(events, self._CONTEXT)
        integrity = evaluate_integrity(events, fv, self._CONTEXT)

        self.assertIn("tamper_signal_detected", integrity["flags"])
        self.assertEqual(integrity["verdict"], "invalid")

    def test_unmanaged_browser_produces_invalid_verdict(self) -> None:
        events = self._base_events() + [
            _make_event("s-inv", "system", "system.browser.unmanaged", 1, ts_offset=10)
        ]
        fv = extract_feature_vector(events, self._CONTEXT)
        integrity = evaluate_integrity(events, fv, self._CONTEXT)

        self.assertIn("unmanaged_browser_detected", integrity["flags"])
        self.assertEqual(integrity["verdict"], "invalid")

    def test_unmanaged_tool_detected_yields_review_not_invalid(self) -> None:
        """unmanaged_tool_detected alone is a review flag, not an invalidating flag."""
        events = self._base_events() + [
            _make_event("s-inv", "system", "system.unmanaged_tool.detected", 1, ts_offset=10)
        ]
        fv = extract_feature_vector(events, self._CONTEXT)
        integrity = evaluate_integrity(events, fv, self._CONTEXT)

        self.assertIn("unmanaged_tool_detected", integrity["flags"])
        self.assertEqual(integrity["verdict"], "review")


# ---------------------------------------------------------------------------
# Integrity: sequence gap detection
# ---------------------------------------------------------------------------

class SequenceGapTests(unittest.TestCase):

    _CONTEXT = {"required_streams": ["desktop", "ide"]}

    def test_sequence_gap_flags_review(self) -> None:
        """Events with a gap in sequence numbers produce sequence_gap_detected."""
        events = [
            _make_event("s-gap", "desktop", "session.started", 1, ts_offset=0),
            _make_event("s-gap", "desktop", "session.heartbeat", 2, ts_offset=5),
            # Sequence jumps from 2 to 4 — gap at 3.
            _make_event("s-gap", "desktop", "desktop.workspace.selected", 4, ts_offset=10),
            _make_event("s-gap", "ide", "ide.extension.activated", 1, ts_offset=2),
        ]
        fv = extract_feature_vector(events, self._CONTEXT)
        integrity = evaluate_integrity(events, fv, self._CONTEXT)

        self.assertIn("sequence_gap_detected", integrity["flags"])
        self.assertEqual(integrity["verdict"], "review")

    def test_no_sequence_gap_when_events_are_contiguous(self) -> None:
        """Contiguous sequence numbers do not trigger the gap flag."""
        events = [
            _make_event("s-ok", "desktop", "session.started", 1, ts_offset=0),
            _make_event("s-ok", "desktop", "session.heartbeat", 2, ts_offset=5),
            _make_event("s-ok", "desktop", "desktop.workspace.selected", 3, ts_offset=10),
            _make_event("s-ok", "ide", "ide.extension.activated", 1, ts_offset=2),
        ]
        fv = extract_feature_vector(events, self._CONTEXT)
        integrity = evaluate_integrity(events, fv, self._CONTEXT)

        self.assertNotIn("sequence_gap_detected", integrity["flags"])


# ---------------------------------------------------------------------------
# Integrity: behavioural flags (bulk paste, focus switching)
# ---------------------------------------------------------------------------

class BehaviouralFlagTests(unittest.TestCase):

    _CONTEXT = {"required_streams": ["desktop", "ide"]}

    def _base_events(self, session_id: str = "s-beh") -> list[dict]:
        return [
            _make_event(session_id, "desktop", "session.started", 1, ts_offset=0),
            _make_event(session_id, "desktop", "session.heartbeat", 2, ts_offset=5),
            _make_event(session_id, "ide", "ide.extension.activated", 1, ts_offset=2),
        ]

    def test_suspicious_bulk_paste_flagged_at_2000_chars(self) -> None:
        """A paste of exactly 2000 characters triggers suspicious_bulk_paste.

        The feature extractor recognises ide.clipboard.paste with pasted_chars
        in the payload as the source of max_paste_length.
        """
        paste_event = _make_event(
            "s-beh",
            "ide",
            "ide.clipboard.paste",
            2,
            payload={"pasted_chars": 2000, "pasted_text": "x" * 2000},
            ts_offset=10,
        )
        events = self._base_events() + [paste_event]
        fv = extract_feature_vector(events, self._CONTEXT)
        integrity = evaluate_integrity(events, fv, self._CONTEXT)

        self.assertIn("suspicious_bulk_paste", integrity["flags"])
        self.assertEqual(integrity["verdict"], "review")

    def test_small_paste_does_not_flag_suspicious_bulk_paste(self) -> None:
        paste_event = _make_event(
            "s-beh",
            "ide",
            "ide.clipboard.paste",
            2,
            payload={"pasted_chars": 50},
            ts_offset=10,
        )
        events = self._base_events() + [paste_event]
        fv = extract_feature_vector(events, self._CONTEXT)
        integrity = evaluate_integrity(events, fv, self._CONTEXT)

        self.assertNotIn("suspicious_bulk_paste", integrity["flags"])

    def test_excessive_focus_switching_flagged_at_30(self) -> None:
        """30 or more os.focus.changed events trigger excessive_focus_switching."""
        focus_events = [
            _make_event(
                "s-beh",
                "desktop",
                "os.focus.changed",
                3 + i,
                payload={"app_category": "browser"},
                ts_offset=15 + i,
            )
            for i in range(30)
        ]
        events = self._base_events() + focus_events
        fv = extract_feature_vector(events, self._CONTEXT)
        integrity = evaluate_integrity(events, fv, self._CONTEXT)

        self.assertIn("excessive_focus_switching", integrity["flags"])

    def test_unsupported_ai_provider_flagged(self) -> None:
        """Prompt from an AI provider not in the allowed list raises a flag."""
        context = {
            "required_streams": ["desktop", "ide", "browser"],
            "allowed_ai_providers": ["openai"],
        }
        events = [
            _make_event("s-ai", "desktop", "session.started", 1, ts_offset=0),
            _make_event("s-ai", "desktop", "session.heartbeat", 2, ts_offset=5),
            _make_event("s-ai", "ide", "ide.extension.activated", 1, ts_offset=2),
            _make_event(
                "s-ai",
                "browser",
                "browser.ai.prompt",
                1,
                payload={"provider": "google", "prompt_text": "help", "prompt_length": 4},
                ts_offset=8,
            ),
        ]
        fv = extract_feature_vector(events, context)
        integrity = evaluate_integrity(events, fv, context)

        self.assertIn("unsupported_ai_provider", integrity["flags"])
        self.assertEqual(integrity["verdict"], "review")

    def test_allowed_ai_provider_not_flagged(self) -> None:
        context = {
            "required_streams": ["desktop", "ide", "browser"],
            "allowed_ai_providers": ["openai"],
        }
        events = [
            _make_event("s-ok", "desktop", "session.started", 1, ts_offset=0),
            _make_event("s-ok", "desktop", "session.heartbeat", 2, ts_offset=5),
            _make_event("s-ok", "ide", "ide.extension.activated", 1, ts_offset=2),
            _make_event(
                "s-ok",
                "browser",
                "browser.ai.prompt",
                1,
                payload={"provider": "openai", "prompt_text": "help", "prompt_length": 4},
                ts_offset=8,
            ),
        ]
        fv = extract_feature_vector(events, context)
        integrity = evaluate_integrity(events, fv, context)

        self.assertNotIn("unsupported_ai_provider", integrity["flags"])

    def test_unsupported_site_via_missing_allowed_site_field_in_known_domain_list(self) -> None:
        """Navigation to a domain not in allowed_sites and allowed_site=None triggers flag."""
        context = {
            "required_streams": ["desktop", "ide", "browser"],
            "allowed_sites": ["developer.mozilla.org"],
            "allowed_ai_providers": [],
        }
        events = [
            _make_event("s-site", "desktop", "session.started", 1, ts_offset=0),
            _make_event("s-site", "desktop", "session.heartbeat", 2, ts_offset=5),
            _make_event("s-site", "ide", "ide.extension.activated", 1, ts_offset=2),
            _make_event(
                "s-site",
                "browser",
                "browser.navigation",
                1,
                payload={
                    "url": "https://unknown-site.com/",
                    "domain": "unknown-site.com",
                    "allowed_site": None,
                },
                ts_offset=8,
            ),
        ]
        fv = extract_feature_vector(events, context)
        integrity = evaluate_integrity(events, fv, context)

        self.assertIn("unsupported_site_visited", integrity["flags"])
        self.assertEqual(integrity["verdict"], "review")


# ---------------------------------------------------------------------------
# Integrity: multiple review flags still produce verdict=review
# ---------------------------------------------------------------------------

class MultipleReviewFlagTests(unittest.TestCase):

    def test_multiple_review_flags_yield_review_not_invalid(self) -> None:
        """Accumulating non-invalidating flags keeps the verdict at 'review'."""
        context = {
            "required_streams": ["desktop", "ide"],
            "allowed_ai_providers": ["openai"],
        }
        events = [
            # Missing heartbeat so telemetry_heartbeat_missing fires.
            _make_event("s-multi", "desktop", "session.started", 1, ts_offset=0),
            # Sequence gap (2 → 4).
            _make_event("s-multi", "desktop", "desktop.workspace.selected", 4, ts_offset=5),
            _make_event("s-multi", "ide", "ide.extension.activated", 1, ts_offset=2),
            _make_event("s-multi", "system", "system.unmanaged_tool.detected", 1, ts_offset=15),
        ]
        fv = extract_feature_vector(events, context)
        integrity = evaluate_integrity(events, fv, context)

        self.assertGreater(len(integrity["flags"]), 1)
        self.assertEqual(integrity["verdict"], "review")


# ---------------------------------------------------------------------------
# Scoring: output shape and required keys
# ---------------------------------------------------------------------------

class ScoringOutputShapeTests(unittest.TestCase):
    """score_session always returns the required set of keys."""

    _REQUIRED_KEYS = {
        "session_id",
        "model_version",
        "scoring_mode",
        "haci_score",
        "haci_band",
        "predicted_archetype",
        "archetype_probabilities",
        "confidence",
        "top_features",
        "integrity",
        "policy_recommendation",
        "review_required",
        "heuristic_result",
        "trained_model_result",
        "feature_vector",
    }

    def test_score_session_output_contains_all_required_keys(self) -> None:
        events = _minimal_valid_events()
        result = score_session(events, {"required_streams": ["desktop", "ide"]})
        for key in self._REQUIRED_KEYS:
            self.assertIn(key, result, f"Missing key: {key}")

    def test_haci_score_is_clamped_between_0_and_100(self) -> None:
        events = _minimal_valid_events()
        result = score_session(events, {"required_streams": ["desktop", "ide"]})
        self.assertGreaterEqual(result["haci_score"], 0.0)
        self.assertLessEqual(result["haci_score"], 100.0)

    def test_haci_band_matches_haci_score_thresholds(self) -> None:
        events = _minimal_valid_events()
        result = score_session(events, {"required_streams": ["desktop", "ide"]})
        score = result["haci_score"]
        band = result["haci_band"]
        if score >= 70:
            self.assertEqual(band, "high")
        elif score >= 40:
            self.assertEqual(band, "medium")
        else:
            self.assertEqual(band, "low")

    def test_heuristic_result_always_present_and_well_formed(self) -> None:
        events = _minimal_valid_events()
        result = score_session(events, {"required_streams": ["desktop", "ide"]})
        hr = result["heuristic_result"]
        self.assertIsNotNone(hr)
        self.assertEqual(hr["scoring_mode"], "heuristic")
        self.assertGreater(hr["confidence"], 0.0)
        self.assertAlmostEqual(sum(hr["archetype_probabilities"].values()), 1.0, places=2)

    def test_score_session_does_not_crash_on_events_with_minimal_payload(self) -> None:
        """Events that have an empty payload dict should not raise an exception."""
        events = [
            {
                "event_id": "d-1",
                "session_id": "minimal",
                "timestamp_utc": "2026-04-15T09:00:00Z",
                "source": "desktop",
                "event_type": "session.started",
                "sequence_no": 1,
                "artifact_ref": "session",
                "payload": {},
                "client_version": "0.1.0",
                "integrity_hash": "h1",
                "policy_context": {},
            }
        ]
        # Should not raise; result is well-defined even for a single-event session.
        result = score_session(events, {"required_streams": []})
        self.assertIn("haci_score", result)


# ---------------------------------------------------------------------------
# Scoring: decision policy tests
# ---------------------------------------------------------------------------

class DecisionPolicyTests(unittest.TestCase):
    """Tests that the auto-advance policy fires correctly under different thresholds.

    Uses mocked integrity and HACI to isolate policy logic from scoring variance,
    following the pattern established in test_pipeline.py.
    """

    _MOCK_CLEAN_INTEGRITY = {
        "verdict": "clean",
        "flags": [],
        "missing_streams": [],
        "required_streams_present": ["desktop", "ide"],
        "invalidation_reasons": [],
        "haci_score": None,
        "predicted_archetype": None,
    }

    _MOCK_INVALID_INTEGRITY = {
        "verdict": "invalid",
        "flags": ["missing_required_streams"],
        "missing_streams": ["ide"],
        "required_streams_present": ["desktop"],
        "invalidation_reasons": [],
        "haci_score": None,
        "predicted_archetype": None,
    }

    def _score_mocked(self, session_context: dict) -> dict:
        """Score with clean integrity and high HACI, similar to test_pipeline.py helper."""
        import importlib
        import assessment_analytics.scoring as scoring

        with patch.dict("os.environ", {}, clear=True):
            importlib.reload(scoring)
            with (
                patch("assessment_analytics.scoring.evaluate_integrity",
                      return_value=self._MOCK_CLEAN_INTEGRITY),
                patch("assessment_analytics.scoring._compute_haci", return_value=(70.0, [])),
                patch("assessment_analytics.scoring._predict_with_trained_model", return_value=None),
            ):
                return scoring.score_session(_minimal_valid_events(), session_context)

    def test_very_low_threshold_triggers_auto_advance_with_high_confidence_session(self) -> None:
        """A threshold of 0.01 should trigger auto-advance when heuristic confidence is higher."""
        context = {
            "required_streams": ["desktop", "ide"],
            "decision_policy": {"auto_advance_min_confidence": 0.01},
        }
        result = self._score_mocked(context)
        # Heuristic confidence from the minimal events should be above 0.01.
        self.assertGreater(result["confidence"], 0.01)
        self.assertEqual(result["policy_recommendation"], "auto-advance")
        self.assertFalse(result["review_required"])

    def test_strict_threshold_blocks_auto_advance(self) -> None:
        """A threshold of 0.99 should prevent auto-advance for typical heuristic output."""
        context = {
            "required_streams": ["desktop", "ide"],
            "decision_policy": {"auto_advance_min_confidence": 0.99},
        }
        result = self._score_mocked(context)
        self.assertLess(result["confidence"], 0.99)
        self.assertEqual(result["policy_recommendation"], "human-review")
        self.assertTrue(result["review_required"])

    def test_invalid_integrity_overrides_policy_even_with_low_threshold(self) -> None:
        """If integrity is invalid, policy_recommendation must be invalid-session."""
        import importlib
        import assessment_analytics.scoring as scoring

        events = _minimal_valid_events()
        with patch.dict("os.environ", {}, clear=True):
            importlib.reload(scoring)
            with (
                patch("assessment_analytics.scoring.evaluate_integrity",
                      return_value=self._MOCK_INVALID_INTEGRITY),
                patch("assessment_analytics.scoring._predict_with_trained_model", return_value=None),
            ):
                result = scoring.score_session(
                    events,
                    {
                        "required_streams": ["desktop", "ide"],
                        "decision_policy": {"auto_advance_min_confidence": 0.01},
                    },
                )

        self.assertEqual(result["policy_recommendation"], "invalid-session")
        self.assertTrue(result["review_required"])


if __name__ == "__main__":
    unittest.main()
