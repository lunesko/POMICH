"""Read POMICH JSON vital lines from stdin and print p75 by page and viewport.

Example: docker logs pomich-app 2>&1 | python scripts/ops/web_vitals_report.py
"""

from __future__ import annotations

import json
import math
import sys
from collections import defaultdict


def summarize(lines: list[str]) -> list[tuple[str, str, str, int, float, bool]]:
    samples: dict[tuple[str, str, str], list[float]] = defaultdict(list)
    for line in lines:
        start = line.find('{"event":"web_vital"')
        if start < 0:
            continue
        try:
            row = json.loads(line[start:])
        except ValueError:
            continue
        page, viewport, name, value = (row.get(key) for key in ("page", "viewport", "name", "value"))
        if page not in {"landing", "customer", "provider", "admin"} or viewport not in {"mobile", "desktop"}:
            continue
        if name not in {"LCP", "INP", "CLS"} or type(value) not in (float, int) or not math.isfinite(value):
            continue
        samples[(page, viewport, name)].append(value)

    limits = {"LCP": 2500, "INP": 200, "CLS": 0.1}
    result = []
    for (page, viewport, name), values in sorted(samples.items()):
        values.sort()
        p75 = values[math.ceil(len(values) * 0.75) - 1]
        result.append((page, viewport, name, len(values), p75, p75 <= limits[name]))
    return result


if __name__ == "__main__":
    print("page viewport metric samples p75 target")
    for page, viewport, name, count, p75, good in summarize(list(sys.stdin)):
        status = "good" if good else "needs_work"
        if count < 100:
            status += " (small_sample)"
        print(f"{page} {viewport} {name} {count} {p75:.3f} {status}")
