# ADR 0005: Promotion Boundary

Status: Proposed
Date: 2026-05-29

## Context

Hephaestus can target its own repository, but self-targeting is not the same as
self-improvement. A generated or applied patch becomes self-improvement only
when a verified successor worker becomes the active worker and the old worker
can be retained or rolled back to.

Without a promotion boundary, runtime self-edits risk corrupting the active
process or overstating autonomy.

## Decision

Introduce an explicit promotion boundary between "verified change exists" and
"new worker is active."

Promotion requires:

- promotable attempt
- structured patch evidence
- passing verification evidence
- policy snapshot
- worker version metadata
- explicit approval for runtime, tool, policy, or supervisor changes
- rebuild or startup validation
- health check
- rollback record

Promotion emits events:

- promotion.requested
- promotion.verified
- promotion.started
- promotion.health_check_passed
- promotion.completed
- promotion.failed
- promotion.rolled_back

## Consequences

- Hephaestus should not claim recursive self-improvement until promotion and
  rollback exist.
- Runtime/tool/policy changes remain human-approved by default.
- Worker version metadata becomes part of evidence.
- The supervisor becomes a first-class architecture component.

## Follow-Up

- Define `WorkerVersion` and `Promotion` domain objects.
- Add a supervisor health-check interface.
- Add D5 tests for failed successor startup and rollback records.
