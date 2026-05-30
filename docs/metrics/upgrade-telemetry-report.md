# Upgrade Telemetry Report

Generated: 2026-05-30T00:28:43.166Z

## Queue
- Total tickets: 316
- Pending tickets: 0
- In progress tickets: 0
- Queue pressure index: 0.099

## Aging
- Pending age p50 (h): 0
- Pending age p95 (h): 0
- Pending age max (h): 0

## Execution
- Attempts: 208
- Attempts per ticket: 0.658
- Retry rate: 0.082
- Started last 24h: 117
- Completed last 24h: 49
- Admission->start p95 (ms): 3715731

## Churn
- Superseded rate: 0.639
- Cancelled rate: 0.061
- Superseded/completed ratio: 2.133

## Policy
- Allowlist denial count: 45
- Allowlist denial rate: 0.216
- Command calls: 156
- Command ID calls: 0
- Raw command calls: 156
- Command ID usage rate: 0
- Allowlist command denial count: 42
- Allowlist command denial rate: 0.269
- Command IDs: none observed
- Failure bucket command is not allowlisted: 37
- Failure bucket unsupported task envelope: 33
- Failure bucket structured plan validation failed: 16
- Failure bucket recovered stale active ticket after a previous daemon exited before fini: 11
- Failure bucket file: 11
- Failure bucket command failed: 9
- Failure bucket recovered orphaned active attempt before starting a new attempt: 5

## Root Causes (Top-3)
- Deny reason command is not allowlisted: 37
- Deny reason command failed: 3
- Deny reason file read target docs/metrics/qwen-wave/w1-ticket-03-allowlist-command-s: 1
- Supersede reason implemented in consolidated telemetry-first execution wave (upgrade-tele: 128
- Supersede reason processed in replay: 10
- Supersede reason implemented in code during roadmap execution: 5
- Retry reason deferred in remediation-first wave: 3
- Retry reason implemented by stop_all: 2
- Retry reason testing ticket from cli planned files: 1

## Alerts
- superseded-rate-high:0.639
- allowlist-denial-rate-high:0.216

