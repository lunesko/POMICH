import json

from scripts.ops.web_vitals_report import summarize


def test_report_uses_nearest_rank_p75_and_ignores_non_vital_lines() -> None:
    lines = [
        "prefix " + json.dumps({"event": "web_vital", "page": "landing", "viewport": "mobile", "name": "LCP", "value": value}, separators=(",", ":"))
        for value in (1000, 2000, 3000, 4000)
    ]
    lines += ['{"event":"other","value":999}', 'private /orders/123']
    assert summarize(lines) == [("landing", "mobile", "LCP", 4, 3000, False)]
