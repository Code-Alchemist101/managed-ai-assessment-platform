from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
from typing import Any

from .catalog import EXTRACTION_VERSION, SIGNAL_CATALOG
from .utils import (
    count_comment_lines,
    entropy_score,
    extract_function_map,
    jaccard_similarity,
    levenshtein_distance,
    line_diff_stats,
    normalized_similarity,
    parse_timestamp,
    safe_mean,
    variance,
)


TYPING_PAUSE_THRESHOLD_SECONDS = 2.0


def _sort_events(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(events, key=lambda event: parse_timestamp(event["timestamp_utc"]))


def _timestamps(events: list[dict[str, Any]]) -> list[datetime]:
    return [parse_timestamp(event["timestamp_utc"]) for event in events]


def _seconds_between(start: datetime, end: datetime) -> float:
    return max(0.0, (end - start).total_seconds())


def _get_payload_number(payload: dict[str, Any], key: str, fallback: int | float = 0) -> float:
    value = payload.get(key, fallback)
    if isinstance(value, (int, float)):
        return float(value)
    return float(fallback)


def _get_text_length(payload: dict[str, Any], text_key: str, size_key: str) -> int:
    if size_key in payload and isinstance(payload[size_key], (int, float)):
        return int(payload[size_key])
    text = payload.get(text_key, "")
    return len(text) if isinstance(text, str) else 0


def _detect_prompt_class(prompt_text: str) -> dict[str, bool]:
    prompt = prompt_text.lower()
    clarification_terms = ["explain", "clarify", "what", "why", "help me understand", "?"]
    solution_terms = ["write", "solve", "complete", "full solution", "implement", "give me code"]
    debugging_terms = ["debug", "fix", "error", "traceback", "bug", "failing test", "exception"]
    return {
        "clarification": any(term in prompt for term in clarification_terms),
        "solution": any(term in prompt for term in solution_terms),
        "debugging": any(term in prompt for term in debugging_terms),
    }


def extract_feature_vector(events: list[dict[str, Any]], session_context: dict[str, Any] | None = None) -> dict[str, Any]:
    session_context = session_context or {}
    events = _sort_events(events)
    if not events:
        raise ValueError("Cannot extract features from an empty event list.")

    session_id = events[0]["session_id"]
    problem_statement = session_context.get("problem_statement", "")
    start_time = parse_timestamp(events[0]["timestamp_utc"])
    end_time = parse_timestamp(events[-1]["timestamp_utc"])
    session_duration = _seconds_between(start_time, end_time)

    doc_changes = [event for event in events if event["event_type"] == "ide.document.changed"]
    copy_events = [event for event in events if event["event_type"] == "ide.clipboard.copy"]
    paste_events = [event for event in events if event["event_type"] == "ide.clipboard.paste"]
    command_events = [event for event in events if event["event_type"] == "ide.command.executed"]
    run_events = [
        event
        for event in events
        if event["event_type"] in {"ide.task.started", "ide.debug.started", "ide.run.started", "ide.terminal.executed"}
    ]
    prompt_events = [event for event in events if event["event_type"] in {"browser.ai.prompt", "ide.ai.prompt"}]
    response_events = [event for event in events if event["event_type"] in {"browser.ai.response", "ide.ai.response"}]
    acceptance_events = [event for event in events if event["event_type"] == "ide.ai.accepted"]
    diagnostics_events = [event for event in events if event["event_type"] == "ide.diagnostics.changed"]
    snapshot_events = [event for event in events if event["event_type"] == "ide.snapshot"]
    save_events = [event for event in events if event["event_type"] == "ide.document.saved"]
    focus_events = [event for event in events if event["event_type"] == "os.focus.changed"]
    idle_events = [event for event in events if event["event_type"] == "os.idle"]

    insert_event_count = sum(1 for event in doc_changes if _get_payload_number(event["payload"], "inserted_chars", 0) > 0)
    delete_event_count = sum(1 for event in doc_changes if _get_payload_number(event["payload"], "deleted_chars", 0) > 0)
    pasted_lengths = [_get_text_length(event["payload"], "pasted_text", "pasted_chars") for event in paste_events]
    undo_events = sum(1 for event in command_events if "undo" in str(event["payload"].get("command_id", "")).lower())
    redo_events = sum(1 for event in command_events if "redo" in str(event["payload"].get("command_id", "")).lower())

    typing_events = [
        event
        for event in doc_changes
        if event["payload"].get("change_source", "typing") not in {"paste", "ai_accept"}
        and _get_payload_number(event["payload"], "inserted_chars", 0) > 0
    ]
    typing_timestamps = _timestamps(typing_events)
    typing_latencies = [
        (typing_timestamps[index] - typing_timestamps[index - 1]).total_seconds() * 1000
        for index in range(1, len(typing_timestamps))
    ]
    typing_pauses = [latency / 1000 for latency in typing_latencies if latency / 1000 >= TYPING_PAUSE_THRESHOLD_SECONDS]
    typing_burst_count = 0
    if typing_events:
        typing_burst_count = 1
        for latency in typing_latencies:
            if latency / 1000 >= TYPING_PAUSE_THRESHOLD_SECONDS:
                typing_burst_count += 1

    typed_chars = sum(_get_payload_number(event["payload"], "inserted_chars", 0) for event in typing_events)
    pasted_chars_total = sum(pasted_lengths)
    active_typing_seconds = sum(max(0.5, latency / 1000) for latency in typing_latencies if latency / 1000 < TYPING_PAUSE_THRESHOLD_SECONDS)
    if typing_events and not active_typing_seconds:
        active_typing_seconds = max(1.0, _seconds_between(typing_timestamps[0], typing_timestamps[-1]))
    avg_typing_speed = (typed_chars / max(active_typing_seconds, 1.0)) * 60

    activity_events = _sort_events(doc_changes + focus_events + idle_events + prompt_events + response_events + run_events)
    activity_times = [parse_timestamp(event["timestamp_utc"]) for event in activity_events]
    idle_before_paste: list[float] = []
    for paste_event in paste_events:
        paste_time = parse_timestamp(paste_event["timestamp_utc"])
        prior_times = [activity_time for activity_time in activity_times if activity_time < paste_time]
        if prior_times:
            idle_before_paste.append(_seconds_between(prior_times[-1], paste_time))

    snapshots = [
        (
            parse_timestamp(event["timestamp_utc"]),
            int(event["payload"].get("revision", 0)),
            str(event["payload"].get("content", "")),
            str(event["payload"].get("language_id", "")),
        )
        for event in snapshot_events
    ]
    snapshots.sort(key=lambda item: item[0])
    if not snapshots and doc_changes:
        synthesized = "".join(str(event["payload"].get("inserted_text", "")) for event in doc_changes)
        snapshots = [(parse_timestamp(events[0]["timestamp_utc"]), 1, synthesized, "")]

    revision_diffs = []
    function_rewrite_count = 0
    comment_addition_count = 0
    for index in range(1, len(snapshots)):
        _, _, previous_content, _ = snapshots[index - 1]
        _, _, current_content, _ = snapshots[index]
        added, removed, replaced = line_diff_stats(previous_content, current_content)
        revision_diffs.append((added, removed, replaced, previous_content, current_content))
        previous_functions = extract_function_map(previous_content)
        current_functions = extract_function_map(current_content)
        for function_name, current_body in current_functions.items():
            if function_name in previous_functions:
                similarity = normalized_similarity(previous_functions[function_name], current_body)
                if similarity < 0.7:
                    function_rewrite_count += 1
        comment_addition_count += max(0, count_comment_lines(current_content) - count_comment_lines(previous_content))

    first_code = parse_timestamp(doc_changes[0]["timestamp_utc"]) if doc_changes else start_time
    first_prompt = parse_timestamp(prompt_events[0]["timestamp_utc"]) if prompt_events else end_time

    compile_error_count = sum(int(_get_payload_number(event["payload"], "errors", 0)) for event in diagnostics_events)
    error_fix_durations: list[float] = []
    current_error_started: datetime | None = None
    for event in diagnostics_events:
        event_time = parse_timestamp(event["timestamp_utc"])
        errors = int(_get_payload_number(event["payload"], "errors", 0))
        if errors > 0 and current_error_started is None:
            current_error_started = event_time
        elif errors == 0 and current_error_started is not None:
            error_fix_durations.append(_seconds_between(current_error_started, event_time))
            current_error_started = None

    prompt_lengths = [_get_text_length(event["payload"], "prompt_text", "prompt_length") for event in prompt_events]
    prompt_texts = [str(event["payload"].get("prompt_text", "")) for event in prompt_events]
    prompt_similarity_to_problem = safe_mean([jaccard_similarity(prompt_text, problem_statement) for prompt_text in prompt_texts], 0.0)
    prompt_refinement_count = 0
    for index in range(1, len(prompt_texts)):
        overlap = jaccard_similarity(prompt_texts[index - 1], prompt_texts[index])
        if overlap >= 0.35 and len(prompt_texts[index]) >= len(prompt_texts[index - 1]):
            prompt_refinement_count += 1

    classified_prompts = [_detect_prompt_class(prompt_text) for prompt_text in prompt_texts]
    clarification_prompt_ratio = safe_mean([1.0 if item["clarification"] else 0.0 for item in classified_prompts], 0.0)
    solution_request_ratio = safe_mean([1.0 if item["solution"] else 0.0 for item in classified_prompts], 0.0)
    debugging_prompt_ratio = safe_mean([1.0 if item["debugging"] else 0.0 for item in classified_prompts], 0.0)

    response_count = len(response_events)
    acceptance_rate = len(acceptance_events) / response_count if response_count else 0.0
    ai_edit_distances = [
        levenshtein_distance(
            str(event["payload"].get("accepted_text", "")),
            str(event["payload"].get("final_text", event["payload"].get("accepted_text", ""))),
        )
        for event in acceptance_events
    ]

    prompt_to_code_latencies = []
    doc_change_times = _timestamps(doc_changes)
    for prompt_event in prompt_events:
        prompt_time = parse_timestamp(prompt_event["timestamp_utc"])
        next_code = next((change_time for change_time in doc_change_times if change_time > prompt_time), None)
        if next_code is not None:
            prompt_to_code_latencies.append(_seconds_between(prompt_time, next_code))

    ai_prompt_times = _timestamps(prompt_events)
    early_window_end = start_time.timestamp() + session_duration * 0.25
    late_window_start = start_time.timestamp() + session_duration * 0.75
    ai_usage_early_ratio = (
        sum(1 for prompt_time in ai_prompt_times if prompt_time.timestamp() <= early_window_end) / len(ai_prompt_times)
        if ai_prompt_times
        else 0.0
    )
    ai_usage_late_ratio = (
        sum(1 for prompt_time in ai_prompt_times if prompt_time.timestamp() >= late_window_start) / len(ai_prompt_times)
        if ai_prompt_times
        else 0.0
    )

    iteration_cycles = []
    for run_event in run_events:
        run_time = parse_timestamp(run_event["timestamp_utc"])
        prior_edit = next((change_time for change_time in reversed(doc_change_times) if change_time <= run_time), None)
        next_review = next(
            (parse_timestamp(event["timestamp_utc"]) for event in diagnostics_events if parse_timestamp(event["timestamp_utc"]) >= run_time),
            None,
        )
        if prior_edit is not None and next_review is not None:
            iteration_cycles.append(_seconds_between(prior_edit, next_review))

    dwell_time_by_category = defaultdict(float)
    sorted_focus_events = _sort_events(focus_events)
    for index, event in enumerate(sorted_focus_events):
        current_time = parse_timestamp(event["timestamp_utc"])
        next_time = parse_timestamp(sorted_focus_events[index + 1]["timestamp_utc"]) if index + 1 < len(sorted_focus_events) else end_time
        category = str(event["payload"].get("app_category", "other")).lower()
        dwell_time_by_category[category] += _seconds_between(current_time, next_time)

    idle_seconds = sum(_get_payload_number(event["payload"], "idle_seconds", 0) for event in idle_events)

    signal_values = {
        "total_insert_events": float(insert_event_count),
        "total_delete_events": float(delete_event_count),
        "total_copy_events": float(len(copy_events)),
        "total_paste_events": float(len(paste_events)),
        "avg_paste_length": float(safe_mean(pasted_lengths, 0.0)),
        "max_paste_length": float(max(pasted_lengths) if pasted_lengths else 0.0),
        "paste_to_insert_ratio": float(len(paste_events) / insert_event_count) if insert_event_count else 0.0,
        "undo_events": float(undo_events),
        "redo_events": float(redo_events),
        "run_compile_events": float(len(run_events)),
        "avg_typing_speed": float(avg_typing_speed),
        "typing_burst_count": float(typing_burst_count),
        "typing_pause_frequency": float(len(typing_pauses)),
        "avg_pause_duration": float(safe_mean(typing_pauses, 0.0)),
        "longest_pause": float(max(typing_pauses) if typing_pauses else 0.0),
        "key_latency_mean": float(safe_mean(typing_latencies, 0.0)),
        "key_latency_variance": float(variance(typing_latencies)),
        "paste_after_idle_time": float(safe_mean(idle_before_paste, 0.0)),
        "typing_vs_paste_ratio": float(typed_chars / pasted_chars_total) if pasted_chars_total else float(typed_chars),
        "code_edit_distance": float(1.0 - normalized_similarity(snapshots[0][2], snapshots[-1][2]) if len(snapshots) >= 2 else 0.0),
        "total_code_versions": float(max(len(snapshots), len(save_events))),
        "avg_lines_added_per_revision": float(safe_mean([item[0] for item in revision_diffs], 0.0)),
        "avg_lines_removed_per_revision": float(safe_mean([item[1] for item in revision_diffs], 0.0)),
        "refactor_frequency": float(sum(1 for event in command_events if any(keyword in str(event["payload"].get("command_id", "")).lower() for keyword in ("refactor", "rename", "extract")))),
        "compile_error_count": float(compile_error_count),
        "error_fix_time": float(safe_mean(error_fix_durations, 0.0)),
        "code_rewrite_ratio": float(safe_mean([replaced / max(1, added + replaced) for added, _, replaced, _, _ in revision_diffs], 0.0)),
        "function_rewrite_count": float(function_rewrite_count),
        "comment_addition_count": float(comment_addition_count),
        "total_prompts_sent": float(len(prompt_events)),
        "avg_prompt_length": float(safe_mean(prompt_lengths, 0.0)),
        "max_prompt_length": float(max(prompt_lengths) if prompt_lengths else 0.0),
        "prompt_similarity_to_problem": float(prompt_similarity_to_problem),
        "prompt_refinement_count": float(prompt_refinement_count),
        "prompt_entropy": float(safe_mean([entropy_score(prompt_text) for prompt_text in prompt_texts], 0.0)),
        "clarification_prompt_ratio": float(clarification_prompt_ratio),
        "solution_request_ratio": float(solution_request_ratio),
        "debugging_prompt_ratio": float(debugging_prompt_ratio),
        "ai_response_acceptance_rate": float(acceptance_rate),
        "ai_output_edit_distance": float(safe_mean(ai_edit_distances, 0.0)),
        "prompt_to_code_latency": float(safe_mean(prompt_to_code_latencies, 0.0)),
        "session_duration": float(session_duration),
        "time_to_first_code": float(_seconds_between(start_time, first_code)),
        "time_to_first_ai_prompt": float(_seconds_between(start_time, first_prompt)) if prompt_events else float(session_duration),
        "ai_usage_early_ratio": float(ai_usage_early_ratio),
        "ai_usage_late_ratio": float(ai_usage_late_ratio),
        "iteration_cycle_count": float(len(iteration_cycles)),
        "avg_cycle_duration": float(safe_mean(iteration_cycles, 0.0)),
        "focus_switch_count": float(len(focus_events)),
        "browser_to_editor_ratio": float(dwell_time_by_category["browser"] / dwell_time_by_category["editor"] if dwell_time_by_category["editor"] else 0.0),
        "idle_ratio": float(idle_seconds / session_duration) if session_duration else 0.0,
    }

    sources_present = {event["source"] for event in events}
    required_streams = set(session_context.get("required_streams", ["desktop", "ide", "browser"]))

    signals = []
    invalidation_reasons = []
    overall_completeness = "complete"
    for item in SIGNAL_CATALOG:
        name = item["name"]
        missing_streams = [stream for stream in item["required_streams"] if stream not in sources_present]
        completeness = "complete" if not missing_streams else "missing"
        if missing_streams:
            overall_completeness = "partial"
        signals.append(
            {
                "name": name,
                "category": item["category"],
                "classification": item["classification"],
                "value": round(float(signal_values.get(name, 0.0)), 4),
                "completeness": completeness,
                "provenance": item["required_streams"],
                "description": item["description"],
            }
        )

    missing_required = sorted(required_streams - sources_present)
    if missing_required:
        invalidation_reasons.append(f"missing required streams: {', '.join(missing_required)}")

    return {
        "session_id": session_id,
        "extraction_version": EXTRACTION_VERSION,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "signal_values": {key: round(float(value), 4) for key, value in signal_values.items()},
        "signals": signals,
        "completeness": "complete" if not invalidation_reasons and overall_completeness == "complete" else overall_completeness,
        "invalidation_reasons": invalidation_reasons,
    }
