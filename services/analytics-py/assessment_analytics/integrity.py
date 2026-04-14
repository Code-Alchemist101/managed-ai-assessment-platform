from __future__ import annotations

from collections import defaultdict
from typing import Any


def evaluate_integrity(
    events: list[dict[str, Any]],
    feature_vector: dict[str, Any],
    session_context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    session_context = session_context or {}
    required_streams = set(session_context.get("required_streams", ["desktop", "ide", "browser"]))
    allowed_sites = set(session_context.get("allowed_sites", []))
    allowed_ai_providers = set(session_context.get("allowed_ai_providers", []))

    present_streams = {event["source"] for event in events}
    missing_streams = sorted(required_streams - present_streams)
    flags: list[str] = []
    notes: list[str] = []

    if missing_streams:
        flags.append("missing_required_streams")
        notes.append(f"Missing streams: {', '.join(missing_streams)}")

    sequence_tracker: dict[str, list[int]] = defaultdict(list)
    for event in events:
        sequence_tracker[event["source"]].append(int(event.get("sequence_no", 0)))
        if event["event_type"] in {"browser.ai.prompt", "browser.ai.response"}:
            provider = str(event["payload"].get("provider", "")).lower()
            if allowed_ai_providers and provider and provider not in allowed_ai_providers:
                flags.append("unsupported_ai_provider")
        if event["event_type"] == "browser.navigation":
            domain = str(event["payload"].get("domain", "")).lower()
            allowed_site = event["payload"].get("allowed_site")
            if allowed_site is False:
                flags.append("unsupported_site_visited")
            elif allowed_sites and domain and allowed_site is None and domain not in allowed_sites:
                flags.append("unsupported_site_visited")
        if event["event_type"] == "system.unmanaged_tool.detected":
            flags.append("unmanaged_tool_detected")
        if event["event_type"] == "system.tamper.detected":
            flags.append("tamper_signal_detected")

    for source, sequence_numbers in sequence_tracker.items():
        ordered = sorted(sequence_numbers)
        expected = list(range(ordered[0], ordered[0] + len(ordered))) if ordered else []
        if ordered and ordered != expected:
            flags.append("sequence_gap_detected")
            notes.append(f"Sequence gap detected for {source}")

    heartbeat_present = any(event["event_type"] == "session.heartbeat" for event in events)
    if "desktop" in present_streams and not heartbeat_present:
        flags.append("telemetry_heartbeat_missing")

    focus_switch_count = feature_vector["signal_values"].get("focus_switch_count", 0)
    max_paste_length = feature_vector["signal_values"].get("max_paste_length", 0)
    idle_ratio = feature_vector["signal_values"].get("idle_ratio", 0)

    if max_paste_length >= 2000:
        flags.append("suspicious_bulk_paste")
    if focus_switch_count >= 30:
        flags.append("excessive_focus_switching")
    if idle_ratio >= 0.5:
        flags.append("excessive_idle_time")

    if any(event["event_type"] == "system.browser.unmanaged" for event in events):
        flags.append("unmanaged_browser_detected")

    verdict = "clean"
    if any(flag in flags for flag in ("missing_required_streams", "tamper_signal_detected", "unmanaged_browser_detected")):
        verdict = "invalid"
    elif flags:
        verdict = "review"

    return {
        "verdict": verdict,
        "flags": sorted(set(flags)),
        "required_streams_present": sorted(present_streams & required_streams),
        "missing_streams": missing_streams,
        "notes": notes,
    }
