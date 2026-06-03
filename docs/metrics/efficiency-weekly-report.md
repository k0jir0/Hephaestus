# Hephaestus Weekly Efficiency Report

Generated: 2026-06-03T16:49:20.959Z

## Current 7-Day Window

- Samples: 41
- Average efficiency score: 32.973
- Average throughput/day: 9.463
- Average p95 admission->complete (ms): 12900988.854
- Average completion rate: 0.291
- Average retry rate: 0.149
- Average allowlist denial rate: 0.005

## Week-over-Week Delta

- Efficiency score delta: 32.973
- Throughput/day delta: 9.463
- p95 admission->complete delta (ms): 12900988.854
- Completion rate delta: 0.291
- Retry rate delta: 0.149
- Allowlist denial rate delta: 0.005

## Denial Taxonomy (Latest Snapshot)

- none observed

## Cohort Attribution (Latest Snapshot)

- FIX: tickets=4, completion=1.000, retry=0.000, contribution=100.000
- PERSIST: tickets=2, completion=1.000, retry=0.000, contribution=100.000
- CHANGE: tickets=2, completion=1.000, retry=0.000, contribution=100.000
- BUILD: tickets=1, completion=1.000, retry=0.000, contribution=100.000
- TRANSFORM: tickets=1, completion=1.000, retry=0.000, contribution=100.000

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
- completion-rate variance alert z=-648518346341350.5
- efficiency-score variance alert z=-2.025
- completion-rate variance alert z=-4.359
- completion-rate variance alert z=-3
- completion-rate variance alert z=-2.38
- completion-rate variance alert z=-2

