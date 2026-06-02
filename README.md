# Hephaestus

Hephaestus is a local-first AI engineering workflow product for turning queued software work into inspectable, policy-gated execution plans. It keeps canonical ticket state in a local SQLite store, can project that state into an operator-facing board view, gathers repository context, routes work through configurable AI backends, and records structured plans plus visible state transitions so operators can see how work moves from intake to attempted execution.

This repository is configured to run Hephaestus on itself by default. That makes it useful as a GitHub-ready demonstration of governed AI engineering workflow instead of an opaque "magic agent" claim.

## Core Capabilities

- canonical ticket storage in local SQLite with optional markdown board projection
- policy-gated tool execution with approval and resume flows for risky mutations
- structured execution plans with explicit files, commands, verification steps, and risks
- durable attempt, side-effect, evidence, and lifecycle event recording
- attempt-scoped workspaces (shared-root or isolated git worktree)
- operator control surfaces across CLI, REST API, SSE streams, and browser UI
- promotion and rollback domain records with lifecycle guards and operator visibility
- reliability and source-grounding metrics with repeatable audit commands

## Core Principles

- local-first operation and inspectable state
- explicit policy boundaries over implicit agent behavior
- durable, replayable workflow history
- fail-closed mutation and delivery behavior for safety
- operator-in-the-loop approvals for sensitive actions

## Scope

Hephaestus is an engineering control plane, not a general autonomous programmer. It executes bounded read, search, patch, and verification plans through a governed tool runtime; pauses for approval when required; records durable artifacts and evidence; and exports local patch bundles for developer review.

### Non-Goals

- not a fully autonomous coding system that bypasses operator review
- not a cloud multi-tenant orchestration platform
- not a replacement for branch protection, CI policy, or code review
- not a direct branch/push/PR automation path in the default runtime

## Workflow Overview

1. Intake: create work as tickets in the SQLite store.
2. Admission: apply readiness and policy gates before queue mutation.
3. Planning: produce structured plans with intended files, commands, verification, and risk notes.
4. Execution: run governed tools in a bounded runtime with policy enforcement.
5. Review: inspect evidence, gates, timeline, and artifacts in CLI or UI.
6. Resolution: complete, block, retry, supersede, or cancel with durable state transitions.

## Quick Start

Windows (PowerShell):

```powershell
# Install dependencies
npm install

# Configure environment
Copy-Item .env.example .env

# Validate configuration before launch
npm run validate:config

# Create work in the ticket store
npm run tickets -- create "Inspect the runtime flow"

# Start the numbered operator CLI from the project folder
.\start.ps1

# Or run it directly through npm if you prefer
npm run cli

# Run one bounded demo pass
npm run start:once

# Or launch the operator UI
npm run ui

# Or run in watcher mode
npm run start
```

POSIX shell (macOS/Linux):

```bash
npm install
cp .env.example .env
npm run validate:config
npm run tickets -- create "Inspect the runtime flow"
npm run cli
```

Canonical operator path:

- Canonical launcher: `.\start.ps1`
- Numbered control plane: `npm run cli`
- Service-level runs for development and verification: `npm run start`, `npm run start:once`, `npm run ui`

Self-hosted proof path:

- `npm run tickets -- render-board`
- `npm run tickets -- metrics`
- `npm run ui`
- open `http://127.0.0.1:4180/?token=<your-token>`

## Default Demo Setup

The default `.env.example` targets the current repository:

```env
TARGET_PROJECT=.
```

That means the agent reads and reasons about this repository itself. To point it at another project, set `TARGET_PROJECT` to a different path.

## Scripts

- `npm run build` compiles the TypeScript source into `dist/`
- `start.ps1` launches the numbered operator control plane from the repository root
- `npm run cli` starts the numbered operator control plane for stack lifecycle, tickets, reliability, and logs
- `npm run preflight` validates config, repo files, and backend reachability
- `npm run start` builds and starts watcher mode
- `npm run start:once` builds, processes the current queue once, and exits
- `npm run ui` starts the local UI server with REST, SSE, and the operator UI
- `npm run dev` runs the agent directly from source with `tsx`
- `npm run dev:once` runs a single-pass source-mode demo
- `npm run tickets -- <command>` creates, lists, retries, and inspects canonical tickets
- `npm run models:report` prints the active model profile, installed Ollama models, and upgrade recommendations
- `npm run models:smoke -- <model>` checks whether a local Ollama model can return strict JSON
- `npm run models:benchmark -- --models codellama:latest,gpt-oss:20b,qwen3-coder:30b` compares candidate models on small agent-discipline checks
- `npm run metrics:source-grounding` writes source-grounding snapshots and markdown reports
- `npm run metrics:source-grounding:audit` runs strict source-evidence drift and missing-evidence gates
- `npm test` runs contract, repository, runtime, and smoke tests

## Task Lifecycle

Hephaestus uses a section-based task projection:

```text
Queue -> In Progress -> Completed
                     -> Blocked
```

Pending work belongs in the ticket store. As work starts, the projected board moves those tickets into `In Progress`. When a task succeeds, it moves into `Completed`.

Before a task leaves `Queue`, Hephaestus now runs an admission gate that checks policy and runtime readiness first. If admission fails, the task stays queued and the blocker is recorded in `AGENT.md`.

If startup preflight determines that the configured AI backend is unavailable, Hephaestus now enters a paused execution state instead of attempting predictable failures against the queue. That keeps pending work intact until backend readiness is restored.

If a task fails after it has already moved into `In Progress`, Hephaestus now moves it into a `Blocked` section instead of leaving it stranded. That keeps the queue accurate and makes operator follow-up explicit.

`TASKS.md` is now an optional projection, not the canonical source of truth. Hephaestus stores durable ticket state in `TICKETS_DB_FILE` and rewrites the markdown board from that store when projection is available. New work should be created through the ticket CLI rather than by editing markdown. Projection failures now surface explicit retry scheduling instead of silently disabling board updates for the rest of the process. Set `TASK_BOARD_PROJECTION_ENABLED=false` if projection writes are noisy or intentionally disabled.

When a task is admitted, the executor now returns a structured plan instead of only free-form prose. Each successful plan contains:

- intended file targets
- intended commands
- verification steps
- risk notes

The runtime now talks to explicit task and memory repository interfaces. The default task implementation uses a local SQLite ticket store with markdown projection. Markdown-only fallback is available only when `ALLOW_MARKDOWN_TASK_FALLBACK=true`, so ticket-store failures do not silently change runtime behavior.

## Ticket CLI

```bash
npm run tickets -- create "Add a retry policy"
npm run tickets -- list --status blocked
npm run tickets -- show ticket_abc123
npm run tickets -- approve ticket_abc123 approver@example.com "Looks safe to resume"
npm run tickets -- resume ticket_abc123
npm run tickets -- retry ticket_abc123
npm run tickets -- retry ticket_abc123 --amend "Retry with a narrower file target"
npm run tickets -- cancel ticket_abc123 "Superseded by ticket_456"
npm run tickets -- supersede ticket_abc123 "Covered by a newer ticket"
npm run tickets -- export-bundle ticket_abc123
npm run tickets -- attempts ticket_abc123
npm run tickets -- audit-source-evidence --max-drifted 0 --max-missing-evidence 0
npm run tickets -- render-board
```

## UI Access

The UI server is local-first and token-gated. By default it binds to `127.0.0.1:4180`.

The current CLI defaults to the same UI port (`4180`), so stack status checks and "Open UI" actions target the same control-plane endpoint.

If `UI_TOKENS` is unset, Hephaestus starts the UI with a local development admin token and logs that token on startup. To define explicit roles, set:

```env
UI_TOKENS=viewer:viewer-token,operator:operator-token,approver:approver-token,admin:admin-token
UI_PORT=4180
UI_HOST=127.0.0.1
UI_SSE_INTERVAL_MS=2000
```

Supported UI roles are `viewer`, `operator`, `approver`, and `admin`.

## Security Posture

- Development mode may auto-generate a local admin UI token when `UI_TOKENS` is unset.
- Treat the logged development token as sensitive, local-only bootstrap material.
- For shared machines or production-like environments, always set explicit `UI_TOKENS` and restrict host binding.
- Keep `UI_HOST=127.0.0.1` unless you have a deliberate reverse-proxy or network policy in place.
- Preserve fail-closed behavior for risky mutations and delivery operations.

Recommended production-like baseline:

```env
UI_TOKENS=viewer:<strong-token>,operator:<strong-token>,approver:<strong-token>,admin:<strong-token>
UI_HOST=127.0.0.1
TASK_BOARD_PROJECTION_ENABLED=true
ALLOW_MARKDOWN_TASK_FALLBACK=false
```

## Runtime Requirements

Hephaestus requires Node.js 22.5 or newer because the default ticket store uses `node:sqlite`.

## Tool Runtime

The typed engineering tools live behind a policy runtime. It supports bounded repository search, protected-path-aware file reads, patch dry-runs and application through `git apply`, and exact allowlisted verification commands. Branch, commit, and PR delivery remain fail-closed; the supported delivery path is a local patch bundle with manifest provenance for developer review.

## Architecture

See `docs/architecture.md` for the current runtime shape and the shift-left roadmap.

## Verification Matrix

Use the following checks to verify key system claims:

| Capability | Command | Expected Evidence |
|---|---|---|
| Build integrity | `npm run build` | Successful TypeScript compile and refreshed `dist/` output |
| Contract/runtime correctness | `npm test` | Passing contract, repository, runtime, and smoke suites |
| Config and backend readiness | `npm run preflight` | Readiness gate output with actionable failures when misconfigured |
| Source-grounding health | `npm run metrics:source-grounding` | Snapshot + markdown report under `docs/metrics/` |
| Source-evidence drift gate | `npm run metrics:source-grounding:audit` | Strict drift/missing-evidence pass-fail signal |
| Ticket lifecycle and projection | `npm run tickets -- render-board` | Markdown board projection synchronized from SQLite state |
| Operator control-plane visibility | `npm run ui` | Local UI with ticket, gate, and evidence inspection surfaces |

## Project Structure

Canonical source and interfaces:

```text
Hephaestus/
├── src/
│   ├── agent.ts                # Agent orchestration
│   ├── executor.ts             # Plan execution and policy wiring
│   ├── runtime.ts              # Governed tool runtime
│   ├── repositories.ts         # Ticket and memory repository interfaces
│   ├── preflight.ts            # Startup readiness checks
│   └── ...                     # Config, contracts, logging, safety, types
├── scripts/                    # Helper scripts for tests, ops, and metrics
├── docs/
│   ├── architecture.md         # Runtime architecture and roadmap
│   └── metrics/                # Reliability and source-grounding reports
├── test/                       # Unit and integration tests
├── AGENT.md                    # Project state projection and operator notes
├── TASKS.md                    # Optional markdown board projection
├── start.ps1                   # Canonical numbered control-plane launcher
└── package.json                # Script and dependency manifest
```

Runtime and generated artifacts:

```text
Hephaestus/
├── .hephaestus/                # Local runtime state and generated artifacts
├── .hephaestus-tickets.db*     # Canonical SQLite ticket store files
├── dist/                       # Compiled TypeScript output
├── logs/                       # Local runtime and ops logs
├── run/                        # Runtime outputs and local bundles
├── sources/                    # Source evidence and reference inputs
├── watch-tasks-board.ps1       # Board watch helper for local operations
└── watch-ollama-stream.ps1     # Model stream watch helper
```

## Safety Controls

- Daily token budget
- Maximum iteration count
- Error threshold shutdown behavior
- Optional git auto-snapshots
- Explicit single-pass mode for demos

## CI

GitHub Actions runs the TypeScript build and the unit tests on every push and pull request.

## Backends

- `copilot` for GitHub Copilot CLI
- `openai` for OpenAI chat completions
- `claude` for Anthropic models
- `ollama` for local model execution

## Local Model Upgrades

Hephaestus treats local model selection as an evidence problem, not a branding problem. The active `AI_MODEL` is resolved against built-in profiles for `codellama`, `gpt-oss`, and `qwen3-coder`, then exposed through config validation, `/health`, `/api/model-status`, and the operations UI.

Recommended upgrade path:

```bash
npm run models:report
ollama pull qwen3-coder:30b
npm run models:smoke -- qwen3-coder:30b
npm run models:benchmark -- --models codellama:latest,qwen3-coder:30b
```

If the machine cannot run `qwen3-coder:30b` comfortably, test `gpt-oss:20b` as the lower-memory structured-output and reasoning candidate. Keep `codellama:latest` as a baseline control rather than the target default.

## License

MIT
