# Field Web Vitals

The browser reports LCP, INP and CLS on page backgrounding. The payload contains
only a page group (`landing`, `customer`, `provider`, `admin`), viewport group
(`mobile`, `desktop`) and numeric values. It contains no URL, account ID, map
position, interaction target or user agent. The public endpoint validates and
logs these allowlisted fields as JSON lines.

After sufficient real traffic, calculate p75 separately per page and viewport:

```bash
docker logs pomich-app 2>&1 | python3 scripts/ops/web_vitals_report.py
```

Targets: LCP ≤ 2500 ms, INP ≤ 200 ms, CLS ≤ 0.1. A group with fewer than 100
samples is marked `small_sample`. INP only appears for sessions with eligible
interactions. The report reflects this one container's available log history;
retain and combine logs centrally before using the numbers for a formal SLO.
The endpoint is unauthenticated, so treat the data as diagnostic until a
bot filtering and sampling strategy is in place. Keep `/internal/metrics` and
logs restricted to operators.
