# ADR 0002: SQLite Event-Led Store

Status: Accepted (Implemented for D2)
Date: 2026-05-29

## Context

Hephaestus already uses SQLite as the canonical ticket store. This is a good
fit for local-first operation. The current store also carries projection,
attempt history, outbox-like side effects, recovery, and scheduling behavior.

The next architecture needs stronger auditability and recovery without
rewriting the storage engine.

## Decision

Keep SQLite as the local persistence adapter, but move toward an event-led
schema:

- current-state tables remain for fast queries
- append-only `domain_events` records every important transition
- structured evidence tables store tool, patch, verification, approval, policy,
  model, workspace, and promotion records
- `side_effects` acts as an outbox with idempotency keys
- projection metadata tracks `TASKS.md`, UI, and metric snapshots

The domain model must not depend on SQLite-specific behavior.

## Consequences

- Ticket and attempt timelines become reconstructable from events.
- `TASKS.md` remains a projection, not a source of truth.
- `AGENT.md` remains a memory ledger, not the audit spine.
- Migrations become more important, but operational debugging becomes simpler.
- D1 should extract domain events and evidence types before D2 adds tables.

## Follow-Up

- Delivered in D2:
    - `domain_events` plus `event_evidence` migrations are active.
    - dual-write and canonical-read fallback paths are active.
    - idempotent legacy backfill into canonical event/evidence tables is active.
    - D2 verifier (`verify-d2`) enforces parity, replay hash stability, and replay correlation coverage.
- Runtime policy decision:
    - strict D2 gates remain opt-in for workflow entrypoints (`autopilot`/`review-wave`) via `--enforce-d2`.
