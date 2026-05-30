# Hephaestus Blueprint v2

Status: D0 architecture freeze draft
Date: 2026-05-29
Source: `notes/design-critique.txt`

## Purpose

Blueprint v2 defines the next architecture target for Hephaestus before more
implementation waves are seeded. It is a freeze document: it names the product
contract, non-goals, domain boundaries, state and evidence model, policy shape,
execution workspace rule, and promotion boundary that future code changes must
serve.

This document does not claim the target architecture is already implemented.
It is the design checkpoint that makes the next implementation phases small,
reviewable, and measurable.

## Product Contract

Hephaestus is a local-first, policy-governed engineering control plane that
turns bounded tickets into auditable plans, isolated changes, verification
evidence, reviewable patch bundles, and optionally promoted worker versions.

It is not a general autonomous programmer. It is a supervised automation system
for durable engineering workflow.

## Architecture Thesis

The next stage of Hephaestus should optimize for:

- explicit domain ownership instead of orchestration gravity in large modules
- formal ticket and attempt state machines
- append-only domain events plus queryable current-state projections
- structured tool, patch, verification, policy, model, and promotion evidence
- declarative policy shared by prompts, validators, runtime, UI, CLI, and tests
- isolated git workspaces for mutation attempts
- human-supervised promotion from verified change to active worker
- operator-visible telemetry with clear population and time-window metadata

The planner may be probabilistic. The control plane boundary must be strict.

## D0 Decisions

The D0 architecture freeze is represented by these initial ADRs:

- `docs/adr/0001-product-contract.md`
- `docs/adr/0002-sqlite-event-led-store.md`
- `docs/adr/0003-worktree-execution.md`
- `docs/adr/0004-command-catalog.md`
- `docs/adr/0005-promotion-boundary.md`

These ADRs are proposed until the first implementation phase validates them.
They should be updated only when a concrete implementation result forces a
different decision.

## Autonomy Level

Default target: Level 2.

- Level 0: inspect and plan only
- Level 1: create patch bundles only
- Level 2: auto-apply low-risk patches in isolated workspaces
- Level 3: auto-promote verified patches after passing gates
- Level 4: unattended self-replacement with rollback

Level 2 is the implementation target for Blueprint v2. Level 3 is allowed only
after promotion and rollback exist, and initially only for docs or tests. Level
4 is a research milestone, not a near-term product mode.

## Golden Demo

The canonical demo for this blueprint is:

Hephaestus receives a bounded ticket to improve one documentation or test file,
plans it, creates an isolated git workspace, applies a patch, runs an
allowlisted verification command, records structured evidence, exposes the diff
in CLI and UI, requests approval when needed, and exports or promotes the result
without corrupting the live worker.

Every D1-D6 implementation step should improve this demo path.

## Non-Goals

Blueprint v2 intentionally does not pursue:

- cloud multi-tenant operation
- team permissions beyond local role tokens
- free-form shell execution as the default command model
- direct mutation of the active worker checkout for autonomous patches
- unattended runtime/tool/policy self-promotion
- making `TASKS.md` canonical again
- broad automatic ticket seeding while quality gates are failing
- UI polish ahead of evidence semantics
- a rewrite away from TypeScript, SQLite, or the current local-first shape

## Current Constraints

The current system already has valuable assets:

- SQLite-backed ticket state
- markdown projection
- structured plan parsing
- governed tool runtime
- approval states
- patch bundle export
- CLI and browser UI
- reliability and telemetry reports
- model diagnostics
- meaningful test coverage

The current system also has architectural pressure points:

- `src/runtime.ts` owns too much orchestration and completion policy.
- `src/task-store.ts` mixes persistence, projection, event-like records,
  outbox behavior, scheduling, recovery, and fallback behavior.
- `src/ui-server.ts` mixes transport, DTO shaping, commands, metrics, and
  view assembly.
- `src/ui.ts` contains the full frontend as one large string.
- Planner/runtime mismatch still appears in allowlist, envelope, and file-read
  failure taxonomies.

Blueprint v2 keeps the working system and extracts boundaries around it.

## Target Layers

The target architecture has four primary layers plus a supervisor.

Domain:

- tickets
- attempts
- plans
- policy
- evidence
- scheduling rules

Application:

- intake service
- admission service
- planning service
- execution service
- verification service
- approval service
- promotion service
- projection service
- telemetry service
- self-audit service

Adapters:

- SQLite event store and projections
- filesystem projections and memory ledger
- model clients
- tool runtime, command runner, patch runner, git workspace manager
- HTTP routes and DTOs
- CLI commands

UI:

- API-backed rendering
- client-side state
- styles
- escaped rendering helpers

Supervisor:

- worker version metadata
- promotion runner
- health check
- rollback

## Proposed Repository Shape

```text
src/
  domain/
    tickets/
    attempts/
    plans/
    policy/
    evidence/
    scheduling/
  application/
  adapters/
    sqlite/
    filesystem/
    model/
    tools/
    http/
    cli/
  supervisor/
  ui/
  main/
```

This shape is a target, not a mandatory first patch. D1 should extract pure
domain code while preserving behavior.

## Domain Objects

Ticket:

- id
- description
- intentClass
- priority
- status
- acceptanceCriteria
- expectedSignal
- createdAt
- updatedAt
- source
- activeAttemptId

Attempt:

- id
- ticketId
- attemptNumber
- workerVersion
- status
- startedAt
- endedAt
- planId
- policySnapshotId
- workspaceId
- terminalReason

Plan:

- id
- ticketId
- attemptId
- modelRunId
- summary
- intent
- intendedFiles
- actionGraph
- verificationPlan
- risks

Action:

- id
- planId
- kind
- arguments
- dependsOn
- policyDecision
- status

ToolRun:

- id
- actionId
- tool
- status
- startedAt
- endedAt
- resultSummary
- reasonCode
- outputRef
- mutatedPaths

VerificationRun:

- id
- attemptId
- commandId
- argv
- exitCode
- outputSummary
- passed
- startedAt
- endedAt

PatchEvidence:

- id
- attemptId
- patchHash
- touchedPaths
- changedLines
- dryRunStatus
- applyStatus
- diffRef

Approval:

- id
- ticketId
- attemptId
- requestReason
- requestedAt
- reviewer
- decision
- decisionAt
- rationale

Promotion:

- id
- attemptId
- fromVersion
- toVersion
- status
- verificationSummary
- healthCheckSummary
- rollbackRef

DomainEvent:

- id
- aggregateType
- aggregateId
- type
- payload
- correlationId
- causationId
- logicalSequence
- createdAt

SideEffect:

- id
- eventId
- type
- payload
- status
- idempotencyKey
- lastError

## State Machine Invariants

The following invariants are required for Blueprint v2:

1. A ticket may have at most one active attempt.
2. An attempt must end exactly once.
3. A completed mutation-intended ticket must have patch evidence touching at
   least one declared mutable path.
4. A completed verification-required ticket must have at least one passing
   verification run or an explicit policy decision that verification is not
   required.
5. A blocked ticket must have a machine-readable reason code.
6. A policy denial must store the policy snapshot that produced it.
7. No tool run may mutate outside its attempt workspace.
8. No promotion may occur without a passing startup and health check.
9. Markdown projection must be derivable from canonical state.
10. UI state must be derivable from API DTOs.
11. Retrying a ticket creates a new attempt.
12. Self-audit may create tickets only within active queue caps.
13. Every state transition emits a domain event in the same transaction as the
    state change.
14. Every side effect has an idempotency key and causation event.

## Event and Evidence Spine

SQLite remains the local store for Blueprint v2, but the domain must not depend
on SQLite-specific behavior. The persistence model should move toward:

- current-state tables for fast operator queries
- append-only `domain_events` for audit and replay
- `side_effects` as an outbox with idempotency keys
- evidence tables for tools, patches, verification, approvals, and promotions
- policy snapshots keyed by signature
- model runs keyed by prompt/response hash
- workspace records keyed by attempt
- projection metadata for `TASKS.md`, UI snapshots, and metric snapshots

The event stream is the audit spine. Current-state tables are projections that
can be checked for drift.

## Policy and Command Catalog

Policy should become data. The target policy system defines:

- path classes: source, tests, docs, config, secrets, generated,
  repository-control
- command IDs with Windows and POSIX argv mappings
- safe, approval-required, and denied command classes
- patch thresholds by path class
- protected path rules
- approval rules and expiry
- model budget and backend rules
- scheduler wave gates
- promotion gates

The same policy must drive:

- prompt instructions
- plan validation
- runtime enforcement
- UI explanations
- CLI repair hints
- tests

The model should normally emit command IDs, not free-form shell strings.

Example:

```json
{
  "name": "command.run",
  "arguments": {
    "commandId": "test_runtime",
    "scope": "runtime"
  }
}
```

The command catalog maps that request to platform-specific argv:

- Windows: `["npm.cmd", "test", "--", "test/runtime.test.ts"]`
- POSIX: `["npm", "test", "--", "test/runtime.test.ts"]`

Free-form commands may exist only as a higher-risk path.

## Execution Workspaces

All mutation attempts should occur in an isolated workspace.

Target flow:

1. Create or reset an attempt workspace.
2. Bind the workspace ID to the attempt.
3. Apply patch dry-run inside the workspace.
4. Apply approved low-risk patch inside the workspace.
5. Run verification inside the workspace.
6. Store patch and verification evidence against the same workspace.
7. Export a patch bundle or submit to promotion.
8. Clean up or archive the workspace by policy.

Direct mutation of the active project root is not the target path for
autonomous work.

## Promotion Boundary

Editing source is not self-improvement. A verified successor becoming the
active worker is self-improvement.

Promotion requires:

- a promotable attempt
- structured patch evidence
- passing verification evidence
- policy snapshot
- worker version metadata
- explicit approval for runtime, tool, policy, or supervisor changes
- rebuild or startup validation
- health check
- rollback record

Promotion events:

- promotion.requested
- promotion.verified
- promotion.started
- promotion.health_check_passed
- promotion.completed
- promotion.failed
- promotion.rolled_back

## Scheduler Rules

The scheduler should be separate from persistence. It owns:

- active ticket cap
- wave size
- fairness
- retry backoff
- retry exhaustion
- remediation-only mode
- approval queue blocking
- backend degraded mode
- model warmup windows
- self-audit seeding
- stale attempt recovery requests

Recommended defaults:

- active cap: 10
- wave size: 3 to 5
- max attempts: 3
- no self-audit seeding while blocked count is greater than 5
- no broad new work while allowlist denial rate is greater than 0.08
- no broad new work while completion rate is less than 0.70
- remediation-only mode when gates fail

## Operator Surface

The operator should be able to answer:

- What is the ticket trying to do?
- What plan did the model produce?
- What policy was active?
- What did the runtime allow or deny?
- What files changed?
- What patch was applied?
- What verification ran?
- What failed?
- What should I do next?
- Is this promotable?
- Which worker version produced it?

Target CLI commands:

- `tickets show <id>`
- `tickets timeline <id>`
- `tickets diff <id>`
- `tickets evidence <id>`
- `tickets policy <id>`
- `tickets verify <id>`
- `tickets promote <id>`
- `tickets recover <id>`
- `tickets gates`
- `tickets doctor`

The browser UI should render stable API DTOs and should not become the owner of
business rules.

## Safety Case

Blueprint v2 treats autonomous code modification as a control problem.

Unacceptable losses:

- Hephaestus corrupts or overwrites source outside intended scope.
- Hephaestus marks work complete without evidence.
- Hephaestus promotes an unhealthy worker.
- Hephaestus hides a policy denial or approval requirement from the operator.
- Hephaestus creates runaway queue churn that blocks useful work.
- Hephaestus leaks secrets or protected repository data through model context
  or artifacts.

Key hazards:

- patch applied outside the attempt workspace
- completion without mutation or verification evidence
- scheduler starts broad work while gates require remediation-only mode
- UI presents stale or partial evidence as current
- promotion occurs without independent health check
- model context includes protected files
- retry repeats a denied action without changed plan, policy, or operator action

Controls:

- workspace path canonicalization and tests
- completion invariants in domain policy
- scheduler gates stored as policy and exposed in CLI/UI
- promotion health-check event
- projection outbox with source revision and drift checks
- protected path classes denied by complete mediation
- retry creates a new attempt and requires changed evidence or explicit review

## Implementation Phases

All D1-D6 tickets should be source-grounded against the active local library.
Use `sources/notes/` as the primary design reference and treat
`sources/library-catalog.md` plus `sources/acquisition-manifest.md` as the
inventory-of-record for what grounding is available.

### D1: Extract Pure Domain

Goal: move semantics out of runtime and task store without changing behavior.

Deliverables:

- ticket state machine
- attempt state machine
- completion policy
- retry policy
- policy decision types
- evidence types
- scheduler gate calculations

Exit criteria:

- `src/runtime.ts` delegates decisions.
- `src/task-store.ts` stores decisions rather than defining them.
- tests still pass.

Library anchors:

- `FooteYoder1997BigBallOfMud`: avoid orchestration gravity while extracting
  domain seams.
- `ClaessenHughes2000`: express lifecycle behavior as invariants that can be
  property-tested during extraction.

### D2: Event and Evidence Spine

Goal: make audit and reconstruction first-class.

Deliverables:

- `domain_events` table
- structured evidence tables
- ticket current-state tables retained as projections
- outbox-backed markdown and memory side effects
- replay and drift checks
- phase notes that cite active library sources for event/evidence tradeoffs

Exit criteria:

- ticket timeline can be reconstructed without reading `AGENT.md`
- "what changed and why" is queryable

Current implementation status (2026-05-29):

- `domain_events` and `event_evidence` are live with additive migrations.
- lifecycle recording is dual-write with canonical read preference and legacy fallback.
- restart-safe backfill hydrates legacy event history into canonical tables.
- `npm run tickets -- verify-d2` enforces parity, replay stability, and correlation coverage.
- optional strict D2 enforcement is available in operator workflow gates:
  `npm run tickets -- autopilot --enforce-d2 ...` and
  `npm run tickets -- review-wave --enforce-d2 ...`.

D2 closure complete:

- final closure note is published at `docs/d2-closure-signoff.md`.
- generated evidence is published at `docs/metrics/d2-closure-latest.json` and `docs/metrics/d2-closure-report.md`.
- closure generator command is `npm run metrics:d2:closure`.
- runtime policy decision: strict D2 gates remain opt-in (`--enforce-d2`) for `autopilot` and `review-wave`.

Library anchors:

- `ChandyLamport1985`: deterministic state reconstruction and consistent
  snapshots.
- `Helland2007LifeBeyondDistributedTransactions`: compensation-oriented,
  append-first workflow thinking.

### D3: Policy and Command Catalog

Goal: remove planner/runtime command mismatch.

Deliverables:

- policy schema
- command IDs and platform mappings
- policy-generated prompt instructions
- policy snapshot per attempt
- pre-execution rejection of unknown command IDs
- command ID usage and allowlist-denial telemetry per attempt

Exit criteria:

- models select command IDs for verification
- command ID usage rate is reported in upgrade telemetry
- allowlist denials become a policy or ticket-quality problem, not a shell
  string problem

Current implementation status (2026-05-29):

- command catalog policy module is live with stable command IDs and
  platform-specific mappings.
- structured planning contract accepts `commandId` and resolves
  commandId-only commands through the catalog.
- runtime rejects unknown command IDs before execution in both plan prelude and
  governed `command.run` tool calls.
- plan binding accepts catalog IDs and emits explicit unknown-ID denials.
- command telemetry captures command ID usage and allowlist denial evidence per
  attempt and flows into upgrade telemetry snapshots.

D3 closure complete:

- D3 command catalog and command-ID runtime enforcement are implemented.
- command-ID usage and allowlist-denial metrics are published via
  `npm run metrics:upgrade-telemetry`.
- D2 regression gate remains passing after D3 changes
  (`npm run metrics:d2:verify`).

Library anchors:

- `Schick2023Toolformer`: explicit tool-call interface design.
- `Yao2023ReAct`: observable reasoning-action traces for operator review.
- `Yang2024SWEAgent` and `Zhang2023RepoCoder`: repository-grounded execution
  contracts and retrieval-aware policy boundaries.

### D4: Isolated Execution Workspaces

Goal: stop applying autonomous mutations directly to the active project root.

Deliverables:

- workspace manager
- attempt-to-workspace binding
- patch and verification execution inside workspace
- workspace-backed patch bundle export
- workspace cleanup/archive policy

Exit criteria:

- low-risk self-edit can be attempted without dirtying active root
- patch bundle and verification evidence reference the same workspace

D4 closure complete:

- attempt-scoped workspace binding is implemented in the runtime and persisted
  in the ticket store
- isolated workspace creation falls back safely to shared-root mode when the
  target project is not a git repository
- git worktree creation and cleanup are validated by the workspace manager
  test suite

Library anchors:

- `Shinn2023Reflexion` and `Madaan2023SelfRefine`: bounded retry and
  self-critique loops with explicit stop conditions.
- `Xia2024Agentless`: preserve a simple baseline path as a control.
- `Zhang2024AutoCodeRover`, `Bairi2023CodePlan`, `Liu2024STALLPlus`,
  `Ding2026SWEReplay`, `Tao2024MAGIS`: repository-scale localization,
  planning, analysis, replay, and orchestration patterns for isolated runs.

### D5: Promotion and Rollback

Goal: cross from self-targeting to self-improvement.

Deliverables:

- worker version model
- promotable attempt model
- promotion request and approval flow
- rebuild/startup validation
- health check
- rollback record

Exit criteria:

- version N creates a verified change
- version N+1 starts and processes the next ticket
- failed version N+1 does not corrupt the loop

D5 foundation in progress:

- domain lifecycle primitives now define allowed transitions for promotion
  records and worker versions
- promotion status now maps directly to stable promotion event names for
  downstream event emission wiring
- transition guards are enforced by dedicated domain tests for valid and
  invalid promotion and rollback flows
- SQLite persistence now stores worker versions and promotion records with
  migration-backed schema updates and guarded status-transition writes
- runtime promotion orchestration now includes a supervisor validation and
  health-check seam with failed-to-rollback persistence path
- promotion status writes now emit canonical promotion lifecycle events in the
  event spine for auditable requested-to-rolled-back traces
- operator surfaces now expose worker version and promotion record visibility in
  ticket detail API/CLI paths

## D6 Closure Snapshot (2026-05-30)

Since the D5 foundation pass, D6 (Control Plane Refinement) delivered the
control-plane DTO and operator-surface closure increment:

- ticket detail API now joins worker versions and promotions with attempt and
  workspace metadata
- browser timelines surface attempt, workspace, bundle, and version-state
  context for worker versions and promotions
- ticket CLI inspection commands (`timeline`, `evidence`, `gates`, `worker-versions`, `promotions`)
  now print the same enriched promotion context for terminal-first review
- overview and reliability API payloads now include explicit metadata for
  schema version, revision, generation time, and response window/source context
- ticket timeline API DTO (`/api/tickets/:id/timeline`) now exposes a
  chronological event/attempt/promotion stream with explicit payload metadata
- ticket evidence API DTO (`/api/tickets/:id/evidence`) now exposes policy,
  patch, artifact, and side-effect evidence with explicit payload metadata
- ticket gates API DTO (`/api/tickets/:id/gates`) now exposes completion-evidence
  gate status and recovery recommendation payloads with explicit metadata
- browser ticket detail now consumes `/api/tickets/:id/timeline` and renders
  timeline metadata plus chronological entries in an operator-visible panel
- browser ticket detail now consumes `/api/tickets/:id/evidence` and prefers
  structured evidence payloads for patch/policy/artifact/side-effect rendering
- browser ticket detail now consumes `/api/tickets/:id/gates` and prefers gate
  DTO values for completion evidence and recovery recommendation panels

D6 closure complete:

- timeline, evidence, gates, worker-version, and promotion DTO/operator
  inspection surfaces are now live across API, CLI, and UI paths
- response metadata (schema/revision/generatedAt/windows/sources) is present on
  overview/reliability and ticket detail DTO endpoints
- UI panel decomposition is complete for ticket detail DTO consumption; full
  physical file extraction remains tracked as post-D6 implementation hygiene

Library anchors:

- `Amodei2016`: misoptimization and unsafe autonomy failure modes.
- `ClaessenHughes2000`: invariant-based promotion and rollback checks.
- `Helland2007LifeBeyondDistributedTransactions`: compensation and recovery
  posture when promotion fails.

### D6: Control Plane Refinement

Goal: make operation obvious.

Deliverables:

- timeline, diff, evidence, policy, gates, and promotion DTOs
- terminal-first evidence commands
- UI split into manageable modules
- metric payload population/window/schema metadata

Exit criteria:

- operator can inspect any change quickly
- metrics are comparable across reports

Current implementation status (2026-05-30): exit criteria met for D6 control
plane refinement scope.

Library anchors:

- `Endsley1995`: state visibility and situation awareness in the cockpit.
- `LeeSee2004` and `Woods1996`: calibrated trust and anti-autopilot
  complacency.
- `LevesonThomas2018STPAHandbook`: unsafe control action framing for UI and
  operator workflows.

## D2+ Research Grounding Update

The research-library baseline has changed during D0: Hephaestus now has a
local, actively maintained source library under `sources/notes/` and
`sources/papers/`, tracked by `sources/library-catalog.md` and
`sources/acquisition-manifest.md`.

This upgrades D2+ planning from "collect references later" to
"cite implementation-grounding sources now".

Required D2+ grounding by phase:

- D2 event/evidence spine: `ChandyLamport1985`,
  `Helland2007LifeBeyondDistributedTransactions`
- D3 policy and command catalog: `Schick2023Toolformer`, `Yao2023ReAct`,
  `Yang2024SWEAgent`, `Zhang2023RepoCoder`
- D4 isolated execution and bounded retries: `Shinn2023Reflexion`,
  `Madaan2023SelfRefine`, `Xia2024Agentless`, `Zhang2024AutoCodeRover`,
  `Bairi2023CodePlan`, `Liu2024STALLPlus`, `Ding2026SWEReplay`,
  `Tao2024MAGIS`
- D3-D6 operator and safety controls: `Endsley1995`, `LeeSee2004`,
  `Woods1996`, `LevesonThomas2018STPAHandbook`, `Amodei2016`,
  `ClaessenHughes2000`, `FooteYoder1997BigBallOfMud`

Blueprint implication:

- Every D2+ implementation ticket should include a short source-grounding
  note in the ticket or ADR context, referencing at least one active library
  note that informed the chosen design.

## D0 Exit Criteria

D0 is complete when:

- this blueprint exists
- ADRs 0001-0005 exist
- the golden demo is accepted as the implementation target
- autonomy level is set to Level 2
- large ticket waves are paused
- D1 tickets are bounded to pure-domain extraction
- `npm.cmd run lint` passes

## First D1 Ticket

Recommended first implementation ticket:

Extract a pure ticket and attempt domain package from current lifecycle logic,
including transition guards and completion invariants, without changing
runtime behavior. Verify with `npm.cmd test -- test/task-lifecycle.test.ts
test/runtime.test.ts` and expected signal: existing lifecycle and runtime tests
pass while no persistence or UI behavior changes.
