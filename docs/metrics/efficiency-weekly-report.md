# Hephaestus Weekly Efficiency Report

Generated: 2026-05-29T13:09:51.003Z

## Current 7-Day Window

- Samples: 12
- Average efficiency score: 52.278
- Average throughput/day: 32.333
- Average p95 admission->complete (ms): 30765459.750
- Average completion rate: 0.384
- Average retry rate: 0.151
- Average allowlist denial rate: 0.009

## Week-over-Week Delta

- Efficiency score delta: 52.278
- Throughput/day delta: 32.333
- p95 admission->complete delta (ms): 30765459.750
- Completion rate delta: 0.384
- Retry rate delta: 0.151
- Allowlist denial rate delta: 0.009

## Denial Taxonomy (Latest Snapshot)

- command is not allowlisted: 4

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
- Top denial bucket: command is not allowlisted - add or document approved command variants.

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

