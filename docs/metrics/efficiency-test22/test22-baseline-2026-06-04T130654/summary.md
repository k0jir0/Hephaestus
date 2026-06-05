# Efficiency Test22 Summary

- Run ID: test22-baseline-2026-06-04T130654
- Mode: baseline
- Timestamp: 2026-06-04T13:07:08.4227296-04:00
- Autopilot apply mode: False

## Metrics

- Score: 29.586
- Completed last 24h: 7
- Completion rate: 0.29
- Retry rate: 0.165
- Allowlist denial rate: 0
- p95 admission->complete (ms): 478437554
- Actionable blocked (7 d): 0
- Stale count: 0

## Bands

- Band A (>=40, throughput>=8, retry<=0.14): pass=False streak=0/3
- Band B (>=50, throughput>=10, completion>=0.60, denial<=0.10): pass=False streak=0/5
- Band C (>=58, throughput>=12, retry<=0.10, p95<=3.5h): pass=False streak=0/3
- Band D (>=60, blocked/stale no-growth, audits pass): pass=False streak=0/2

## Controls

- Review-wave decision: NO-GO
- Autopilot paused by gates: True
- Stop reasons: none
- Strict checks pass: True
- Audit checks pass: True

## Top Root Causes

- Deny: command is not allowlisted (37)
- Deny: command failed (3)
- Deny: file read target docs/metrics/qwen-wave/w1-ticket-03-allowlist-command-s (2)
- Retry: cancelled by operator (32)
- Retry: deferred in remediation-first wave (3)
- Retry: implemented by stop_all (2)
- Supersede: implemented in consolidated telemetry-first execution wave (upgrade-tele (128)
- Supersede: processed in replay (10)
- Supersede: implemented in code during roadmap execution (5)

## Log Files

- Metrics efficiency: C:\Users\ryanv\Desktop\MCGILL\McGillSoftware\Hephaestus\docs\metrics\efficiency-test22\test22-baseline-2026-06-04T130654\metrics-efficiency.log
- Metrics weekly: C:\Users\ryanv\Desktop\MCGILL\McGillSoftware\Hephaestus\docs\metrics\efficiency-test22\test22-baseline-2026-06-04T130654\metrics-efficiency-weekly.log
- Upgrade telemetry: C:\Users\ryanv\Desktop\MCGILL\McGillSoftware\Hephaestus\docs\metrics\efficiency-test22\test22-baseline-2026-06-04T130654\metrics-upgrade-telemetry.log
- Tickets metrics: C:\Users\ryanv\Desktop\MCGILL\McGillSoftware\Hephaestus\docs\metrics\efficiency-test22\test22-baseline-2026-06-04T130654\tickets-metrics-source-grounding.log
- Review wave: C:\Users\ryanv\Desktop\MCGILL\McGillSoftware\Hephaestus\docs\metrics\efficiency-test22\test22-baseline-2026-06-04T130654\tickets-review-wave.log
- Autopilot: C:\Users\ryanv\Desktop\MCGILL\McGillSoftware\Hephaestus\docs\metrics\efficiency-test22\test22-baseline-2026-06-04T130654\autopilot-test22.log

