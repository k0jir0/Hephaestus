# Hephaestus Weekly Efficiency Report

Generated: 2026-05-29T03:37:47.327Z

## Current 7-Day Window

- Samples: 6
- Average efficiency score: 43.623
- Average throughput/day: 9.667
- Average p95 admission->complete (ms): 56022125.500
- Average completion rate: 0.506
- Average retry rate: 0.226
- Average allowlist denial rate: 0.006

## Week-over-Week Delta

- Efficiency score delta: 43.623
- Throughput/day delta: 9.667
- p95 admission->complete delta (ms): 56022125.500
- Completion rate delta: 0.506
- Retry rate delta: 0.226
- Allowlist denial rate delta: 0.006

## Denial Taxonomy (Latest Snapshot)

- none observed

## Cohort Attribution (Latest Snapshot)

- IMPLEMENT: tickets=3, completion=1.000, retry=0.000, contribution=100.000
- PERSIST: tickets=2, completion=1.000, retry=0.000, contribution=100.000
- BUILD: tickets=1, completion=1.000, retry=0.000, contribution=100.000
- TRANSFORM: tickets=1, completion=1.000, retry=0.000, contribution=100.000
- DOCUMENT: tickets=1, completion=1.000, retry=0.000, contribution=100.000

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

