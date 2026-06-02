# Hephaestus Weekly Efficiency Report

Generated: 2026-06-02T16:59:19.422Z

## Current 7-Day Window

- Samples: 30
- Average efficiency score: 36.142
- Average throughput/day: 12.933
- Average p95 admission->complete (ms): 15611460.300
- Average completion rate: 0.312
- Average retry rate: 0.139
- Average allowlist denial rate: 0.006

## Week-over-Week Delta

- Efficiency score delta: 36.142
- Throughput/day delta: 12.933
- p95 admission->complete delta (ms): 15611460.300
- Completion rate delta: 0.312
- Retry rate delta: 0.139
- Allowlist denial rate delta: 0.006

## Denial Taxonomy (Latest Snapshot)

- none observed

## Cohort Attribution (Latest Snapshot)

- FIX: tickets=4, completion=1.000, retry=0.000, contribution=100.000
- UPDATE: tickets=3, completion=1.000, retry=0.000, contribution=100.000
- PERSIST: tickets=2, completion=1.000, retry=0.000, contribution=100.000
- CHANGE: tickets=2, completion=1.000, retry=0.000, contribution=100.000
- BUILD: tickets=1, completion=1.000, retry=0.000, contribution=100.000

## Recommended Actions

- Prioritize allowlist policy cleanup because denial rate increased week-over-week.
- Retry rate increased; review transient failure handling and warmup windows.
- Admission-to-complete latency worsened; tune pending-dispatch pacing and queue pressure thresholds.
- Variance alerts are present; schedule bounded mitigation tickets for the top two alert families.

## Variance Alerts (Current Window)

- efficiency-score variance alert z=9.012
- throughput variance alert z=2.828
- completion-rate variance alert z=-3.654
- retry-rate variance alert z=-6.09
- efficiency-score variance alert z=4.604
- throughput variance alert z=2.357
- efficiency-score variance alert z=2.07
- throughput variance alert z=15.499
- completion-rate variance alert z=-2.677
- retry-rate variance alert z=-3.312
- throughput variance alert z=2.415
- efficiency-score variance alert z=-2.459
- retry-rate variance alert z=2.277
- retry-rate variance alert z=2.746
- retry-rate variance alert z=2.649
- retry-rate variance alert z=2.189

