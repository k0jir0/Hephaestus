# D2 Closure Sign-Off

Date: 2026-05-29
Status: Complete
Owner: Hephaestus operator

## Purpose

This document is the formal sign-off checklist for D2 (Event and Evidence Spine)
before D3 begins. It links deliverables and exit criteria to reproducible
commands and generated evidence artifacts.

## Evidence Commands

Run from repository root:

```bash
npm run build
npm test
npm run metrics:d2:verify
npm run metrics:d2:closure
npm run tickets -- autopilot --dry-run --enforce-d2
npm run tickets -- review-wave --enforce-d2
```

Generated artifacts:

- `docs/metrics/d2-closure-latest.json`
- `docs/metrics/d2-closure-history.jsonl`
- `docs/metrics/d2-closure-report.md`
- `docs/metrics/source-grounding-latest.json`

## Deliverables to Evidence Map

- `domain_events` table live:
  - code: `src/task-store.ts`
  - evidence: `npm run metrics:d2:verify`
- structured evidence table live (`event_evidence`):
  - code: `src/task-store.ts`
  - evidence: `docs/metrics/d2-closure-latest.json`
- canonical-read preference with legacy fallback:
  - code: `src/task-store.ts`
  - tests: `test/task-store.test.ts`
- idempotent legacy backfill:
  - code: `src/task-store.ts`
  - tests: `test/task-store.test.ts`
- replay and drift checks:
  - code: `src/task-store.ts`, `src/tickets.ts`
  - evidence: `npm run metrics:d2:verify`, `npm run metrics:d2:closure`
- optional strict gate integration:
  - code: `src/tickets.ts`, `src/domain/scheduling/ticket-autopilot-policy.ts`, `src/ticket-autopilot.ts`
  - tests: `test/ticket-autopilot-policy.test.ts`, `test/ticket-autopilot.test.ts`

## Exit Criteria Checklist

- [x] Build passes (`npm run build`)
- [x] Tests pass (`npm test`)
- [x] D2 strict verifier passes (`npm run metrics:d2:verify`)
- [x] D2 closure report decision is PASS (`npm run metrics:d2:closure`)
- [x] No unexpected D2 failures during burn-in runs of autopilot/review-wave
- [x] D2 default policy decision recorded (stay opt-in or make default)

## D2 Policy Decision

- Decision: keep strict D2 gate enforcement opt-in for runtime workflows.
- Runtime posture: continue using `--enforce-d2` for `autopilot` and `review-wave`.
- Rationale: burn-in demonstrated stable D2 health checks while non-D2 operational gates remain active; keeping opt-in avoids unintentional operational blocking while preserving strict verification paths.

## Burn-In Log

Record each burn-in run with timestamp and result.

| Timestamp (UTC) | Command | Decision | Failure tokens |
| --- | --- | --- | --- |
| 2026-05-29T17:51:14Z | `npm run metrics:d2:closure` | PASS | none |
| 2026-05-29T17:55:19Z | `npm run tickets -- autopilot --dry-run --enforce-d2` | PASS (D2) | none (non-D2 gates: completion/superseded/blocked) |
| 2026-05-29T17:55:22Z | `npm run tickets -- review-wave --enforce-d2` | PASS (D2) | none (non-D2 gates: efficiency/blocked/p95/backend reliability) |

## Final Sign-Off

All D2 closeout criteria are complete as of 2026-05-29. D3 work can proceed.
