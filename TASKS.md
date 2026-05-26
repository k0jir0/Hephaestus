# Hephaestus Task Queue

Add tasks below. The agent processes the Queue section top-to-bottom.

## Queue

<!-- Tasks are processed top-to-bottom. Add new tasks at the bottom. -->
- (empty)

## In Progress

<!-- Currently working on these tasks -->
- (empty)

## Completed

<!-- Finished tasks will be moved here -->
- [x] Transform Hephaestus into a GitHub-submittable demo of AI automation - improve documentation, add LICENSE, tests, CI/CD workflow, and polish code for public release
- [x] Add a constrained code-edit runtime with allowlisted file operations and workspace path boundaries
- [x] Extend the plan contract to declare intended edit actions, command risk levels, and required approvals
- [x] Document the safe-execution model, operator workflow, and failure modes in the architecture and README
- [x] Persist richer execution history in AGENT.md with per-run events, approvals, blocked actions, and verification outcomes
- [x] Add command execution guardrails with an allowlist, timeouts, captured logs, and non-zero-exit failure handling
- [x] Require explicit approval before applying file mutations or running verification commands outside the safe default set
- [x] Add repository policy checks for duplicate queued tasks, invalid task metadata, and malformed task sections
- [x] Add fixture-based tests for edit application, command policy enforcement, approval gating, and rollback-on-failure behavior
- [x] Implement a constrained edit runtime that can create, update, and delete files inside TARGET_PROJECT using explicit workspace path boundaries and dry-run previews
- [x] Add an allowlisted command runner with per-command timeouts, captured stdout or stderr, exit-code handling, and blocked-action reporting for unsafe commands
- [x] Persist structured execution events to AGENT.md and PROGRESS.log including approvals, blocked actions, applied edits, command outcomes, and rollback notes
- [x] Add end-to-end fixture tests that cover successful edit application, approval denial, blocked command attempts, and failure recovery without stranded task state
- [x] Add a ticket event query layer and markdown projection audit so operators can inspect per-ticket history and detect projection drift
- [x] Implement stale ticket recovery with lease timestamps or heartbeats so abandoned in-progress work can be re-queued safely
- [x] Extend the structured plan contract with explicit edit operations, command risk levels, and approval requirements in a machine-runnable schema
- [x] Build a constrained edit-application runtime that can stage creates, updates, and deletes inside TARGET_PROJECT with dry-run previews and rollback metadata
- [x] Implement an allowlisted verification command runner that captures stdout or stderr, enforces timeouts, and records structured results per ticket
- [x] Add an approval gateway abstraction for file mutations and elevated commands with approve, deny, and timeout outcomes persisted on the ticket
- [x] Add ticket retry policies with capped attempts, backoff metadata, and clear transitions between queued, blocked, and cancelled states
- [x] Add startup reconciliation that repairs mismatches between the SQLite ticket store and TASKS.md projection without duplicating queued work
- [x] Add a small operator CLI for listing tickets, viewing ticket events, retrying blocked tickets, and rendering the current task board on demand

## Blocked

<!-- Tasks that need operator attention before they should be retried -->
- [ ] Extend the plan contract and executor prompt so plans can declare executable edit operations, verification commands, and approval requirements in a machine-runnable format
- [ ] Add operator approval gating so file mutations and non-safe verification commands pause for approval instead of executing automatically
- [ ] Add end-to-end self-hosting tests that exercise ticket ingestion from TASKS.md, planning, projection rewrites, blocked retries, and store-backed recovery

## Cancelled

<!-- Tasks that were superseded, repeated, or explicitly cancelled -->
- (empty)

---

**Tip**: Use `- [ ]` for pending tasks. Hephaestus moves tasks between sections as it works.
