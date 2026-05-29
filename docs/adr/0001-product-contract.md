# ADR 0001: Product Contract

Status: Proposed
Date: 2026-05-29

## Context

Hephaestus has grown from a queue-driven planning demo into a local control
plane with durable tickets, structured plans, governed tools, approvals,
telemetry, CLI, and UI. Its strongest path is not to become a general
autonomous programmer, but to become a supervised engineering workflow system
with explicit evidence and policy.

The current design critique identifies a risk of overclaiming autonomy before
workspace isolation, promotion, and rollback exist.

## Decision

Define Hephaestus as:

A local-first, policy-governed engineering control plane that turns bounded
tickets into auditable plans, isolated changes, verification evidence,
reviewable patch bundles, and optionally promoted worker versions.

The default autonomy level for Blueprint v2 is Level 2: auto-apply low-risk
patches only inside isolated workspaces. Runtime, tool, policy, and supervisor
changes require human approval for promotion.

## Consequences

- Product copy, docs, tickets, tests, and UI should avoid claiming general
  autonomous programming.
- New features must strengthen bounded planning, evidence, policy, workspace
  isolation, approval, or promotion.
- Large broad ticket waves should remain paused until D1-D3 reduce planner and
  runtime mismatch.
- Hephaestus may plan or patch its own repo, but it should not claim recursive
  self-improvement until a verified successor can become the active worker.

## Follow-Up

- Keep `docs/blueprint-v2.md` as the target architecture document.
- Add D1 extraction tickets only after this product contract is accepted.
