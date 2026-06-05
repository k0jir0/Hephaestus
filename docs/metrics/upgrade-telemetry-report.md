# Upgrade Telemetry Report

Generated: 2026-06-04T17:07:01.045Z

## Queue
- Total tickets: 367
- Pending tickets: 0
- In progress tickets: 0
- Queue pressure index: 0

## Aging
- Pending age p50 (h): 0
- Pending age p95 (h): 0
- Pending age max (h): 0

## Execution
- Attempts: 322
- Attempts per ticket: 0.877
- Retry rate: 0.172
- Started last 24h: 1
- Completed last 24h: 7
- Admission->start p95 (ms): 3568419

## Churn
- Superseded rate: 0.482
- Cancelled rate: 0.272
- Superseded/completed ratio: 1.967

## Policy
- Allowlist denial count: 46
- Allowlist denial rate: 0.143
- Command calls: 227
- Command ID calls: 71
- Raw command calls: 156
- Command ID usage rate: 0.313
- Allowlist command denial count: 42
- Allowlist command denial rate: 0.185
- Command ID npm.run.build: 58
- Command ID npm.test: 12
- Command ID npm.run.test: 1
- Failure bucket unsupported task envelope: 72
- Failure bucket no governed mutation evidence was recorded for mutable intended files (d: 49
- Failure bucket command is not allowlisted: 37
- Failure bucket file: 21
- Failure bucket structured plan validation failed: 16
- Failure bucket recovered stale active ticket after a previous daemon exited before fini: 15
- Failure bucket command failed: 9

## Root Causes (Top-3)
- Deny reason command is not allowlisted: 37
- Deny reason command failed: 3
- Deny reason file read target docs/metrics/qwen-wave/w1-ticket-03-allowlist-command-s: 2
- Supersede reason implemented in consolidated telemetry-first execution wave (upgrade-tele: 128
- Supersede reason processed in replay: 10
- Supersede reason implemented in code during roadmap execution: 5
- Retry reason cancelled by operator: 32
- Retry reason deferred in remediation-first wave: 3
- Retry reason implemented by stop_all: 2

## Alerts
- superseded-rate-high:0.482
- allowlist-denial-rate-high:0.143

