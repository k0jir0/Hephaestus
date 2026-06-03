# Upgrade Telemetry Report

Generated: 2026-06-03T16:23:52.584Z

## Queue
- Total tickets: 366
- Pending tickets: 0
- In progress tickets: 0
- Queue pressure index: 0.181

## Aging
- Pending age p50 (h): 0
- Pending age p95 (h): 0
- Pending age max (h): 0

## Execution
- Attempts: 318
- Attempts per ticket: 0.869
- Retry rate: 0.172
- Started last 24h: 99
- Completed last 24h: 0
- Admission->start p95 (ms): 3568419

## Churn
- Superseded rate: 0.625
- Cancelled rate: 0.081
- Superseded/completed ratio: 2.133

## Policy
- Allowlist denial count: 46
- Allowlist denial rate: 0.145
- Command calls: 224
- Command ID calls: 68
- Raw command calls: 156
- Command ID usage rate: 0.304
- Allowlist command denial count: 42
- Allowlist command denial rate: 0.188
- Command ID npm.run.build: 58
- Command ID npm.test: 10
- Failure bucket unsupported task envelope: 72
- Failure bucket no governed mutation evidence was recorded for mutable intended files (d: 49
- Failure bucket command is not allowlisted: 37
- Failure bucket file: 20
- Failure bucket structured plan validation failed: 16
- Failure bucket recovered stale active ticket after a previous daemon exited before fini: 14
- Failure bucket command failed: 9

## Root Causes (Top-3)
- Deny reason command is not allowlisted: 37
- Deny reason command failed: 3
- Deny reason file read target docs/metrics/qwen-wave/w1-ticket-03-allowlist-command-s: 2
- Supersede reason implemented in consolidated telemetry-first execution wave (upgrade-tele: 128
- Supersede reason processed in replay: 10
- Supersede reason implemented in code during roadmap execution: 5
- Retry reason unsupported task envelope: 23
- Retry reason file: 5
- Retry reason deferred in remediation-first wave: 3

## Alerts
- superseded-rate-high:0.625
- allowlist-denial-rate-high:0.145
- no-completions-last-24h

