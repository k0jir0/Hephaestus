# Hephaestus Architecture

## Purpose

Hephaestus is intentionally small: it is a local-first AI engineering control plane for durable, policy-bounded software work. The architecture is designed to keep workflow state visible while moving safety, validation, and approval earlier in the lifecycle. The runtime now separates canonical ticket state from the human-readable markdown projection so queue transitions are not coupled to whole-file rewrites.

The next target architecture is captured in `docs/blueprint-v2.md`. That
blueprint is the D0 architecture-freeze document for the event-led store,
command catalog, isolated workspace, and promotion-boundary work.

## Current Runtime Shape

The runtime currently follows this sequence:

1. Load configuration and initialize the runtime service.
2. Run startup preflight against config, repository shape, and backend health.
3. Discover pending tickets from the canonical ticket store.
4. Admit or reject each task before any durable queue mutation.
5. Gather repository context, including focused file-ranking hints for the active ticket.
6. Request a typed task plan from the configured AI backend.
7. Validate the plan contract before executing bounded tool calls and persisting task outcomes into the ticket store.

That keeps the operator-facing surface area simple:

- `TASKS.md` remains an optional operator-facing task board projection.
- `.hephaestus-tickets.db` is the canonical task store by default and records ticket attempts.
- `AGENT.md` remains the persistent memory log.
- The runtime enforces guardrails before work starts instead of after state changes have already happened.

## Module Boundaries

- `src/config.ts`: environment loading plus config validation.
- `src/preflight.ts`: startup checks and task admission decisions.
- `src/agent.ts`: orchestration and runtime loop.
- `src/task-store.ts`: canonical ticket persistence plus optional markdown projection and legacy bootstrap import.
- `src/task-board.ts`: markdown board parsing, hidden ticket IDs, and board rendering.
- `src/watcher.ts`: markdown-only fallback task repository.
- `src/tool-runtime.ts`: typed engineering tools with workspace policy checks.
- `src/memory.ts`: markdown memory persistence.
- `src/executor.ts`: backend-specific AI execution adapters.
- `src/safety.ts`: budget, iteration, and error-threshold policy.

## Phase 1 Shift-Left Work

Phase 1 focuses on catching failures before the agent mutates task state.

- Startup preflight validates config semantics and repo paths without requiring markdown task sections.
- Backend reachability is surfaced before the run starts. If the configured backend is unavailable, the runtime enters a paused state instead of attempting queue execution against a known-bad dependency.
- Task admission happens before the task is moved into `In Progress`.
- Blocked tasks remain in `Queue`, which preserves an accurate queue history.
- If a task fails after admission, the runtime moves it from `In Progress` into `Blocked` so the board reflects that operator intervention is required.

## Phase 2: Structured Planning Contract

Phase 2 is now implemented.

- The executor requests a JSON plan instead of free-form output.
- Successful responses are validated into a typed contract with intended files, commands, verification, and risks.
- Invalid model output fails closed instead of being treated as a successful task result.

## Phase 3: Runtime Core Extraction

Phase 3 is now implemented.

- `src/runtime.ts` owns session lifecycle, single-pass mode, watch mode, timers, and shutdown.
- `src/agent.ts` is now a thin entrypoint.
- Shutdown uses the live runtime services instead of recreating fresh safety and memory instances.

## Phase 4: Repository Adapters

Phase 4 is now implemented and extended.

- The runtime depends on explicit task and memory repository interfaces.
- The default task adapter uses a local SQLite ticket store as the source of truth.
- New work enters through ticket-store operations or the operator CLI instead of markdown edits.
- `TASKS.md` is projected from ticket state and kept only as an optional human-readable view.
- Projection failures now enter an explicit unhealthy state with automatic retry scheduling instead of permanently suspending board updates for the rest of the process.
- A markdown-only fallback remains available only when explicitly enabled by configuration.
- Ticket attempts are recorded durably so later phases can attach patches, verification output, and recovery decisions to a specific attempt.

## Phase 5: Broader Left-Shifted Quality Gates

Phase 5 is now implemented.

- A bounded smoke test now runs the real runtime against markdown fixture files on disk.
- The smoke path validates preflight, queue transitions, and memory persistence without relying on the live repository.
- The test suite covers config validation, admission policy, plan-contract parsing, runtime behavior, and markdown-backed repository flow.

## Next Phases

### Typed Tool Runtime

The first typed tool runtime is implemented and wired into governed task execution.

- `repo.search` performs bounded text search without traversing ignored directories.
- `file.read` reads workspace-bounded files and denies protected paths.
- `patch.apply` validates and applies unified patches through `git apply`, with dry-run support.
- `command.run` executes exact allowlisted commands with timeouts and output limits.
- Risky patch application moves tickets into awaiting approval rather than hiding the decision inside model behavior.
- Branch, commit, and PR tools are defined but fail closed until approval-backed adapters exist.
- Local patch-bundle export is the supported delivery path for developer review.

### Richer Repository Policies

Extend the repository layer with stronger schema checks for queue metadata, duplicate-task detection, and more explicit session/event history.
