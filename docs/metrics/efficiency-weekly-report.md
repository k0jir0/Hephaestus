# Hephaestus Weekly Efficiency Report

Generated: 2026-05-29T12:40:33.005Z

## Current 7-Day Window

- Samples: 11
- Average efficiency score: 51.497
- Average throughput/day: 30.273
- Average p95 admission->complete (ms): 33061520.273
- Average completion rate: 0.395
- Average retry rate: 0.157
- Average allowlist denial rate: 0.009

## Week-over-Week Delta

- Efficiency score delta: 51.497
- Throughput/day delta: 30.273
- p95 admission->complete delta (ms): 33061520.273
- Completion rate delta: 0.395
- Retry rate delta: 0.157
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

