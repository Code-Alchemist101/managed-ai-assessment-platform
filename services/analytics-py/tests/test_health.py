from __future__ import annotations

import importlib
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

PACKAGE_ROOT = Path(__file__).resolve().parents[1]
if str(PACKAGE_ROOT) not in sys.path:
    sys.path.insert(0, str(PACKAGE_ROOT))


class HealthEndpointTests(unittest.TestCase):
    def test_health_returns_heuristic_mode_by_default(self) -> None:
        with patch.dict("os.environ", {}, clear=True):
            import assessment_analytics.scoring as scoring

            importlib.reload(scoring)
            import assessment_analytics.app as app_module

            importlib.reload(app_module)
            client = TestClient(app_module.app)
            response = client.get("/health")

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["status"], "ok")
        self.assertEqual(data["scoring_mode"], "heuristic")
        self.assertEqual(data["model_version"], "bootstrap-centroid-v1")
        self.assertIsNone(data["trained_model_available"])

    def test_health_returns_trained_model_mode_when_configured(self) -> None:
        with patch.dict("os.environ", {"ARCHETYPE_MODE": "trained_model"}, clear=True):
            import assessment_analytics.scoring as scoring

            importlib.reload(scoring)
            import assessment_analytics.app as app_module

            importlib.reload(app_module)
            client = TestClient(app_module.app)
            response = client.get("/health")

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["status"], "ok")
        self.assertEqual(data["scoring_mode"], "trained_model")
        self.assertEqual(data["model_version"], "xgboost-research-v1")
        self.assertTrue(data["trained_model_available"])

    def test_health_reports_fallback_when_artifacts_missing(self) -> None:
        with patch.dict("os.environ", {"ARCHETYPE_MODE": "trained_model"}, clear=True):
            import assessment_analytics.scoring as scoring

            importlib.reload(scoring)
            scoring._MODEL_BUNDLE = None
            scoring._MODEL_LOAD_ERROR = None
            with patch.object(scoring, "ARTIFACTS_DIR", Path("/nonexistent")):
                import assessment_analytics.app as app_module

                importlib.reload(app_module)
                client = TestClient(app_module.app)
                response = client.get("/health")

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["status"], "ok")
        self.assertEqual(data["scoring_mode"], "trained_model")
        self.assertEqual(data["model_version"], "bootstrap-centroid-v1")
        self.assertFalse(data["trained_model_available"])


if __name__ == "__main__":
    unittest.main()
