"""Normalize Ukrainian license plates (Latin + Cyrillic lookalikes)."""

from __future__ import annotations

import re
import unicodedata
from typing import Optional

UA_PLATE_LETTERS = set("ABCEHIKMOPTX")

_CYRILLIC_TO_LATIN = {
    "А": "A",
    "а": "A",
    "В": "B",
    "в": "B",
    "С": "C",
    "с": "C",
    "Е": "E",
    "е": "E",
    "Ё": "E",
    "ё": "E",
    "Н": "H",
    "н": "H",
    "І": "I",
    "і": "I",
    "Ї": "I",
    "ї": "I",
    "К": "K",
    "к": "K",
    "М": "M",
    "м": "M",
    "О": "O",
    "о": "O",
    "Р": "P",
    "р": "P",
    "Т": "T",
    "т": "T",
    "Х": "X",
    "х": "X",
}


def _normalize_char(char: str) -> str:
    compact = unicodedata.normalize("NFKC", char)
    if compact in _CYRILLIC_TO_LATIN:
        return _CYRILLIC_TO_LATIN[compact]
    upper = compact.upper()
    if upper in _CYRILLIC_TO_LATIN:
        return _CYRILLIC_TO_LATIN[upper]
    if upper in {"İ", "I"} or compact in {"i", "ı"}:
        return "I"
    return upper


def parse_ukraine_plate(raw: str) -> str:
    result: list[str] = []
    source = unicodedata.normalize("NFKC", str(raw or ""))
    for char in source:
        if char in {" ", "-", "–", "—", "_", "\u200b", "\ufeff", "\u00a0"}:
            continue
        normalized = _normalize_char(char)
        position = len(result)
        if position < 2 or position >= 6:
            if normalized in UA_PLATE_LETTERS:
                result.append(normalized)
        elif normalized.isdigit():
            result.append(normalized)
        if len(result) >= 8:
            break
    return "".join(result)


def format_ukraine_plate(raw: str) -> str:
    compact = parse_ukraine_plate(raw)
    if not compact:
        return ""
    formatted = compact[:2]
    if len(compact) > 2:
        formatted += f" {compact[2:6]}"
    if len(compact) > 6:
        formatted += f" {compact[6:8]}"
    return formatted


def is_valid_ukraine_plate(raw: str) -> bool:
    compact = parse_ukraine_plate(raw)
    if len(compact) != 8:
        return False
    return (
        all(ch in UA_PLATE_LETTERS for ch in compact[:2])
        and bool(re.fullmatch(r"\d{4}", compact[2:6]))
        and all(ch in UA_PLATE_LETTERS for ch in compact[6:8])
    )


def normalize_ukraine_plate(raw: Optional[str]) -> str:
    """Return canonical spaced plate or empty string when incomplete/invalid."""
    value = str(raw or "").strip()
    if not value:
        return ""
    if not is_valid_ukraine_plate(value):
        # Keep best-effort formatted partial for storage only when already compact-ish.
        formatted = format_ukraine_plate(value)
        return formatted if len(parse_ukraine_plate(value)) == 8 else value
    return format_ukraine_plate(value)
