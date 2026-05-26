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
- [x] Add a ticket event query layer and markdown projection audit so operators can inspect per-ticket history and detect projection drift <!-- hephaestus-ticket:ticket_d57492f1f778 -->
- [x] Implement stale ticket recovery with lease timestamps or heartbeats so abandoned in-progress work can be re-queued safely <!-- hephaestus-ticket:ticket_b2874842bbd5 -->
- [x] Extend the structured plan contract with explicit edit operations, command risk levels, and approval requirements in a machine-runnable schema <!-- hephaestus-ticket:ticket_7c243c5d94ac -->
- [x] Build a constrained edit-application runtime that can stage creates, updates, and deletes inside TARGET_PROJECT with dry-run previews and rollback metadata <!-- hephaestus-ticket:ticket_91e551734f0d -->
- [x] Implement an allowlisted verification command runner that captures stdout or stderr, enforces timeouts, and records structured results per ticket <!-- hephaestus-ticket:ticket_6071450ca460 -->
- [x] Add an approval gateway abstraction for file mutations and elevated commands with approve, deny, and timeout outcomes persisted on the ticket <!-- hephaestus-ticket:ticket_529d1be1413d -->
- [x] Add ticket retry policies with capped attempts, backoff metadata, and clear transitions between queued, blocked, and cancelled states <!-- hephaestus-ticket:ticket_72dfb0579398 -->
- [x] Add startup reconciliation that repairs mismatches between the SQLite ticket store and TASKS.md projection without duplicating queued work <!-- hephaestus-ticket:ticket_3bc70d52c572 -->
- [x] Add a small operator CLI for listing tickets, viewing ticket events, retrying blocked tickets, and rendering the current task board on demand <!-- hephaestus-ticket:ticket_8620b53faaa2 -->
- [x] Transform Hephaestus into a GitHub-submittable demo of AI automation - improve documentation, add LICENSE, tests, CI/CD workflow, and polish code for public release <!-- hephaestus-ticket:ticket_f93e9f799823 -->
- [x] Add a constrained code-edit runtime with allowlisted file operations and workspace path boundaries <!-- hephaestus-ticket:ticket_103710f4b5bf -->
- [x] Extend the plan contract to declare intended edit actions, command risk levels, and required approvals <!-- hephaestus-ticket:ticket_30861b6d9332 -->
- [x] Document the safe-execution model, operator workflow, and failure modes in the architecture and README <!-- hephaestus-ticket:ticket_48c33d0c7f43 -->
- [x] Persist richer execution history in AGENT.md with per-run events, approvals, blocked actions, and verification outcomes <!-- hephaestus-ticket:ticket_2e3b13eb435c -->
- [x] Add command execution guardrails with an allowlist, timeouts, captured logs, and non-zero-exit failure handling <!-- hephaestus-ticket:ticket_dbe0fc242a8a -->
- [x] Require explicit approval before applying file mutations or running verification commands outside the safe default set <!-- hephaestus-ticket:ticket_1c6e28cfbafd -->
- [x] Add repository policy checks for duplicate queued tasks, invalid task metadata, and malformed task sections <!-- hephaestus-ticket:ticket_e9e885c9c007 -->
- [x] Add fixture-based tests for edit application, command policy enforcement, approval gating, and rollback-on-failure behavior <!-- hephaestus-ticket:ticket_be7d57dc7b1b -->
- [x] Implement a constrained edit runtime that can create, update, and delete files inside TARGET_PROJECT using explicit workspace path boundaries and dry-run previews <!-- hephaestus-ticket:ticket_060e97f66ac6 -->
- [x] Add an allowlisted command runner with per-command timeouts, captured stdout or stderr, exit-code handling, and blocked-action reporting for unsafe commands <!-- hephaestus-ticket:ticket_f6977ebfb6f9 -->
- [x] Persist structured execution events to AGENT.md and PROGRESS.log including approvals, blocked actions, applied edits, command outcomes, and rollback notes <!-- hephaestus-ticket:ticket_cc59ef4de623 -->
- [x] Add end-to-end fixture tests that cover successful edit application, approval denial, blocked command attempts, and failure recovery without stranded task state <!-- hephaestus-ticket:ticket_1a9f3faaa7b1 -->

## Blocked

<!-- Tasks that need operator attention before they should be retried -->
- [ ] Add end-to-end self-hosting tests that exercise ticket ingestion from TASKS.md, planning, projection rewrites, blocked retries, and store-backed recovery <!-- hephaestus-ticket:ticket_ecb969cec9d4 -->
- [ ] Extend the plan contract and executor prompt so plans can declare executable edit operations, verification commands, and approval requirements in a machine-runnable format <!-- hephaestus-ticket:ticket_a612151dbdd0 -->
- [ ] Add operator approval gating so file mutations and non-safe verification commands pause for approval instead of executing automatically <!-- hephaestus-ticket:ticket_2537693f1939 -->

## Cancelled

<!-- Tasks that were superseded, repeated, or explicitly cancelled -->
- (empty)

---

**Tip**: Use `- [ ]` for pending tasks. Hephaestus moves tasks between sections as it works.
