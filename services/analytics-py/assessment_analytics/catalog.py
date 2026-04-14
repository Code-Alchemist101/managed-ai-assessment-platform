from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
SIGNAL_CATALOG_PATH = ROOT / "packages" / "contracts" / "src" / "signal-catalog.json"

with SIGNAL_CATALOG_PATH.open("r", encoding="utf-8") as handle:
    SIGNAL_CATALOG = json.load(handle)

SIGNAL_NAMES = [item["name"] for item in SIGNAL_CATALOG]

ARCHETYPES = [
    "Independent Solver",
    "Structured Collaborator",
    "Prompt Engineer Solver",
    "Iterative Debugger",
    "AI-Dependent Constructor",
    "Blind Copier",
    "Exploratory Learner",
]

HACI_WEIGHTS = {
    "typing_vs_paste_ratio": 0.25,
    "prompt_refinement_count": 0.25,
    "time_to_first_ai_prompt": 0.15,
    "ai_output_edit_distance": 0.15,
    "max_paste_length": -0.20,
}

HACI_BOUNDS = {
    "typing_vs_paste_ratio": (0.0, 5.0),
    "prompt_refinement_count": (0.0, 15.0),
    "time_to_first_ai_prompt": (0.0, 1800.0),
    "ai_output_edit_distance": (0.0, 500.0),
    "max_paste_length": (0.0, 2000.0),
}

EXTRACTION_VERSION = "0.1.0"
MODEL_VERSION = "bootstrap-centroid-v1"

