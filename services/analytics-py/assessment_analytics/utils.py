from __future__ import annotations

import math
import re
from collections import Counter
from datetime import datetime, timezone
from difflib import SequenceMatcher
from statistics import mean
from typing import Iterable


TOKEN_PATTERN = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")
COMMENT_PATTERN = re.compile(r"^\s*(#|//|/\*)")


def parse_timestamp(value: str) -> datetime:
    if value.endswith("Z"):
        value = value[:-1] + "+00:00"
    return datetime.fromisoformat(value).astimezone(timezone.utc)


def safe_mean(values: Iterable[float], default: float = 0.0) -> float:
    values = list(values)
    return float(mean(values)) if values else default


def variance(values: list[float]) -> float:
    if len(values) < 2:
        return 0.0
    avg = safe_mean(values)
    return float(sum((value - avg) ** 2 for value in values) / len(values))


def normalized_similarity(left: str, right: str) -> float:
    if not left and not right:
        return 1.0
    if not left or not right:
        return 0.0
    return float(SequenceMatcher(a=left, b=right).ratio())


def levenshtein_distance(left: str, right: str) -> int:
    if left == right:
        return 0
    if not left:
        return len(right)
    if not right:
        return len(left)
    previous = list(range(len(right) + 1))
    for i, left_char in enumerate(left, start=1):
        current = [i]
        for j, right_char in enumerate(right, start=1):
            insertions = previous[j] + 1
            deletions = current[j - 1] + 1
            substitutions = previous[j - 1] + (left_char != right_char)
            current.append(min(insertions, deletions, substitutions))
        previous = current
    return previous[-1]


def jaccard_similarity(left: str, right: str) -> float:
    left_tokens = set(tokenize(left))
    right_tokens = set(tokenize(right))
    if not left_tokens and not right_tokens:
        return 1.0
    if not left_tokens or not right_tokens:
        return 0.0
    return len(left_tokens & right_tokens) / len(left_tokens | right_tokens)


def tokenize(text: str) -> list[str]:
    return [token.lower() for token in TOKEN_PATTERN.findall(text or "")]


def entropy_score(text: str) -> float:
    tokens = tokenize(text)
    if len(tokens) < 2:
        return 0.0
    counts = Counter(tokens)
    total = len(tokens)
    entropy = -sum((count / total) * math.log(count / total, 2) for count in counts.values())
    max_entropy = math.log(len(counts), 2) if len(counts) > 1 else 1.0
    return min(1.0, entropy / max_entropy if max_entropy else 0.0)


def extract_function_map(code: str) -> dict[str, str]:
    functions: dict[str, list[str]] = {}
    current_name: str | None = None
    current_lines: list[str] = []
    for line in code.splitlines():
        function_match = re.match(r"^\s*def\s+([A-Za-z_][A-Za-z0-9_]*)", line)
        if function_match:
            if current_name is not None:
                functions[current_name] = current_lines
            current_name = function_match.group(1)
            current_lines = [line]
            continue
        if current_name is not None:
            current_lines.append(line)
    if current_name is not None:
        functions[current_name] = current_lines
    return {name: "\n".join(lines) for name, lines in functions.items()}


def count_comment_lines(code: str) -> int:
    return sum(1 for line in code.splitlines() if COMMENT_PATTERN.match(line))


def line_diff_stats(left: str, right: str) -> tuple[int, int, int]:
    left_lines = left.splitlines()
    right_lines = right.splitlines()
    matcher = SequenceMatcher(a=left_lines, b=right_lines)
    added = 0
    removed = 0
    replaced = 0
    for opcode, a0, a1, b0, b1 in matcher.get_opcodes():
        if opcode == "insert":
            added += b1 - b0
        elif opcode == "delete":
            removed += a1 - a0
        elif opcode == "replace":
            removed += a1 - a0
            added += b1 - b0
            replaced += max(a1 - a0, b1 - b0)
    return added, removed, replaced
