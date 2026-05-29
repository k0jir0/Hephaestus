# EP4 Baseline vs After

Generated: 2026-05-29T23:35:00Z

## Baseline (Pre-EP4)

- Efficiency score: 49.973
- Throughput/day: 11
- Completion rate: 0.443
- Retry rate: 0.159
- Allowlist denial rate: 0.034
- p95 admission-to-complete: 7,293,959 ms

## After EP4 Implementation

- Efficiency score: 53.375
- Throughput/day: 13
- Completion rate: 0.410
- Retry rate: 0.190
- Allowlist denial rate: 0.050
- p95 admission-to-complete: 7,293,959 ms

## Delta

- Efficiency score: +3.402
- Throughput/day: +2.000
- Completion rate: -0.033
- Retry rate: +0.031
- Allowlist denial rate: +0.016
- p95 admission-to-complete: +0 ms

## Notes

- EP4 lifted throughput and net efficiency score immediately.
- Completion-rate and retry-rate regressions indicate queue quality and policy-denial follow-up remains active work.
- Weekly report now includes denial taxonomy, cohort attribution, and recommendation synthesis to focus next tickets.
