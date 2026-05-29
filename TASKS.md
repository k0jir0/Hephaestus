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
- [x] retry ticket_927126d736f1 <!-- hephaestus-ticket:ticket_1ac8aa7b7866 -->
- [x] \ test ticket from cli\ <!-- hephaestus-ticket:ticket_1f34b1711087 -->
- [x] Self-audit: analyze repository and create prioritized improvement tickets <!-- hephaestus-ticket:ticket_bce8692f7c69 -->
- [x] Self-audit (read-only) analyze repo and create improvement tickets - READ ONLY <!-- hephaestus-ticket:ticket_2da0176fc0e6 -->
- [x] Audit this repository, identify concrete startup, reliability, and safety improvements, and create actionable follow-up work. <!-- hephaestus-ticket:ticket_7b6579a8ef1b -->
- [x] Add operator approval gating so file mutations and non-safe verification commands pause for approval instead of executing automatically <!-- hephaestus-ticket:ticket_2537693f1939 -->
- [x] Efficiency P1: Add projection write coalescing/debounce to reduce redundant TASKS.md rewrites <!-- hephaestus-ticket:ticket_7e3148ce3cb6 -->
- [x] Efficiency P1: Add prompt context budget controls for focused high-value files <!-- hephaestus-ticket:ticket_c4d2745803f9 -->
- [x] Efficiency P0: Add cached runtime context snapshot with invalidation and git-status TTL <!-- hephaestus-ticket:ticket_a434477eddef -->
- [x] Efficiency Roadmap 2: Remove full event scans from operational SLO/UI metrics by deriving latency from ticket lifecycle columns and latest board-sync metadata <!-- hephaestus-ticket:ticket_f4bc94f1f408 -->
- [x] Upgrade Roadmap 1 P1: upgrade the Ollama backend to prefer /api/chat with structured JSON controls and telemetry while preserving generate fallback <!-- hephaestus-ticket:ticket_7171f50e7505 -->
- [x] Upgrade Roadmap 1 P2: expose active model profile, installed models, and upgrade recommendations in the operator UI and health API <!-- hephaestus-ticket:ticket_7c32c5c18ee6 -->
- [x] Upgrade Roadmap 1 P3: add strict action schema validation with phases, evidence requirements, and escalation fields <!-- hephaestus-ticket:ticket_2e1efc233451 -->
- [x] Upgrade Roadmap 1 P4: expand model benchmark to ten Hephaestus SWE-bench-lite cases and persist baseline reports <!-- hephaestus-ticket:ticket_ac70f1716648 -->
- [x] Upgrade Roadmap Future F4: add benchmark score and report path visibility to model-status API and CLI output <!-- hephaestus-ticket:ticket_67eb69d2ab89 -->
- [x] Upgrade Roadmap Future F6: update UI model status panel to show benchmark score and promotion readiness <!-- hephaestus-ticket:ticket_54eae1882ed5 -->

## Blocked

<!-- Tasks that need operator attention before they should be retried -->
- (empty)

## Cancelled

<!-- Tasks that were superseded, repeated, or explicitly cancelled -->
- [x] retry ticket_bce8692f7c69 <!-- hephaestus-ticket:ticket_9dc3e4b392da -->
- [x] Self-audit: Analyze repository and generate prioritized improvement tickets. For each low-risk item (<=1 file, <=20 lines changed), implement the change, run tests, and verify. For higher-risk changes request approval. Commit each change separately and update TASKS.md with ticket references. Continue iteratively until no more low-risk improvements remain. <!-- hephaestus-ticket:ticket_927126d736f1 -->
- [x] Self-audit [medium/tooling]: Add a stop_all script that terminates daemon and UI processes from PID files <!-- hephaestus-ticket:ticket_8652a997cf85 -->
- [x] Self-audit [medium/general]: Implement a `/health` endpoint for the UI server and update smoke tests to use it. This would allow us to monitor the health of the application more easily and ensure that it is always available. <!-- hephaestus-ticket:ticket_dad5faf01c0e -->
- [x] Self-audit [medium/general]: Add a `stop_all` script that terminates the daemon and UI processes from PID files. This would make it easier to shut down the application when needed, and ensure that all processes are properly terminated. <!-- hephaestus-ticket:ticket_cda9c04eebbc -->
- [x] Extend the plan contract and executor prompt so plans can declare executable edit operations, verification commands, and approval requirements in a machine-runnable format <!-- hephaestus-ticket:ticket_a612151dbdd0 -->
- [x] Self-audit [high/startup]: Add a /health endpoint to the UI server and update smoke checks to use it <!-- hephaestus-ticket:ticket_3d876b0f11c5 -->
- [x] Add end-to-end self-hosting tests that exercise ticket ingestion from TASKS.md, planning, projection rewrites, blocked retries, and store-backed recovery <!-- hephaestus-ticket:ticket_ecb969cec9d4 -->
- [x] CLI validation ticket 2026-05-28T14:01:04 <!-- hephaestus-ticket:ticket_92dce2c6d60a -->
- [x] CLI validation ticket 2026-05-28T14:01:51 <!-- hephaestus-ticket:ticket_860896e72375 -->
- [x] "CLI validation ticket 2026-05-28T18:03:11.611Z" <!-- hephaestus-ticket:ticket_a1787a295da6 -->
- [x] "CLI validation ticket 2026-05-28T18:04:39.301Z" <!-- hephaestus-ticket:ticket_0687c2abaf14 -->
- [x] "CLI validation ticket 2026-05-28T18:05:20.102Z" <!-- hephaestus-ticket:ticket_d10babe05507 -->
- [x] "CLI validation ticket 2026-05-28T18:06:00.708Z" <!-- hephaestus-ticket:ticket_937107667b91 -->
- [x] "CLI validation ticket 2026-05-28T18:08:53.097Z" <!-- hephaestus-ticket:ticket_439b35330b93 -->
- [x] Run self-check: summarize current blocked tickets and suggest retry order. <!-- hephaestus-ticket:ticket_b9e9f1b254b8 -->
- [x] Efficiency P0: Reduce sync blocking in CLI by migrating non-critical paths to async process/file APIs <!-- hephaestus-ticket:ticket_c8d0615aa941 -->
- [x] Efficiency P0: Add efficiency metrics card in UI from docs/metrics/efficiency-latest.json <!-- hephaestus-ticket:ticket_6e8cc8ecb911 -->
- [x] Efficiency P1: Replace fixed interval pending dispatch with adaptive scheduler <!-- hephaestus-ticket:ticket_0269380dc905 -->
- [x] Efficiency P2: Add codex tandem handoff bundle contract for active tickets <!-- hephaestus-ticket:ticket_db5399e972f8 -->
- [x] Efficiency P2: Add weekly automated variance report generation from efficiency history <!-- hephaestus-ticket:ticket_b5220f915b25 -->
- [x] Efficiency Roadmap 2: Add aggregate ticket count and bounded recent-event store APIs for cheap UI health and recent activity reads <!-- hephaestus-ticket:ticket_0b0ba8d9f494 -->
- [x] Efficiency Roadmap 2: Make efficiency metrics avoid loading the full event log by using ticket created/started/completed timestamps <!-- hephaestus-ticket:ticket_1d68e6ff8f33 -->
- [x] Efficiency Roadmap 2: Optimize Codex handoff export with bulk attempts and bounded per-ticket event history so ChatGPT receives faster handoff context <!-- hephaestus-ticket:ticket_b3a5ae08b832 -->
- [x] Upgrade Roadmap 1 P0: add model profiles for codellama, qwen3-coder, and gpt-oss with capability metadata and config visibility <!-- hephaestus-ticket:ticket_2e4b2b042e83 -->
- [x] Upgrade Roadmap 1 P1: add Ollama model inventory, smoke test, and benchmark CLI so local models are promoted by evidence <!-- hephaestus-ticket:ticket_c3d298bbcf5a -->
- [x] Upgrade Roadmap 1 P2: document candidate model installation and add package scripts for model reporting, smoke testing, and benchmarking <!-- hephaestus-ticket:ticket_142bf6d52cb5 -->
- [x] Upgrade Roadmap 1 P3: add invalid command repair guidance and artifacts so policy denials produce actionable retry context <!-- hephaestus-ticket:ticket_c7b1678b8697 -->
- [x] Upgrade Roadmap 1 P4: add local versus Codex routing policy evidence to model diagnostics and handoff bundles <!-- hephaestus-ticket:ticket_0a0f99ff3e57 -->
- [x] Upgrade Roadmap 1 Replay T1: validate model inventory report and persist baseline snapshot metadata <!-- hephaestus-ticket:ticket_c907fe49df05 -->
- [x] Upgrade Roadmap 1 Replay T2: validate smoke test JSON parsing contract across active local model <!-- hephaestus-ticket:ticket_7ca48867b059 -->
- [x] Upgrade Roadmap 1 Replay T3: validate benchmark matrix output formatting and comparability fields <!-- hephaestus-ticket:ticket_d03947b3aec9 -->
- [x] Upgrade Roadmap 1 Replay T4: verify model profile visibility in CLI/UI health surfaces <!-- hephaestus-ticket:ticket_4d5182b641c8 -->
- [x] Upgrade Roadmap 1 Replay T5: verify Ollama chat-first adapter fallback telemetry fields <!-- hephaestus-ticket:ticket_23c97da5d045 -->
- [x] Upgrade Roadmap 1 Replay T6: verify structured action schema acceptance and rejection paths <!-- hephaestus-ticket:ticket_69155b8b8e85 -->
- [x] Upgrade Roadmap 1 Replay T7: verify invalid command denial emits actionable repair artifact <!-- hephaestus-ticket:ticket_08f98ad743af -->
- [x] Upgrade Roadmap 1 Replay T8: verify local versus Codex routing evidence in handoff bundle output <!-- hephaestus-ticket:ticket_33fdb582c037 -->
- [x] Upgrade Roadmap 1 Replay T9: verify benchmark evidence gating copy in docs and operator messaging <!-- hephaestus-ticket:ticket_3bc5cdc44367 -->
- [x] Upgrade Roadmap 1 Replay T10: finalize roadmap replay summary and board state audit <!-- hephaestus-ticket:ticket_b13987aa22d1 -->
- [x] Upgrade Roadmap Future F1: expand model benchmark harness to 10 deterministic cases and persist per-model benchmark report <!-- hephaestus-ticket:ticket_eca6e2848d69 -->
- [x] Upgrade Roadmap Future F2: add benchmark history storage and latest snapshot API payload for operator visibility <!-- hephaestus-ticket:ticket_8a24829a31b0 -->
- [x] Upgrade Roadmap Future F3: add model recommendation command that factors installed models and host memory tier <!-- hephaestus-ticket:ticket_0c89d65074b1 -->
- [x] Upgrade Roadmap Future F5: add promote-model-to-default command gated by benchmark success threshold <!-- hephaestus-ticket:ticket_e19bfed9f5d7 -->
- [x] Upgrade Roadmap Future F7: run qwen3-coder installation and validate smoke plus benchmark execution <!-- hephaestus-ticket:ticket_d6c5b7ead9ad -->

---

**Tip**: Use `- [ ]` for pending tasks. Hephaestus moves tasks between sections as it works.
