# Hephaestus

Hephaestus is a local-first AI engineering workflow product for turning queued software work into inspectable, policy-gated execution plans. It keeps canonical ticket state in a local SQLite store, can project that state into an operator-facing board view, gathers repository context, routes work through configurable AI backends, and records structured plans plus visible state transitions so operators can see how work moves from intake to attempted execution.

This repository is configured to run Hephaestus on itself by default. That makes it useful as a GitHub-ready demonstration of governed AI engineering workflow instead of an opaque "magic agent" claim.

## Current State (2026-05-28)

Hephaestus has progressed from a queue-driven planning demo into a local operator control plane with durable workflow state, governed execution, reliability tooling, and an operator-facing UI.

Current implemented state includes:

- canonical ticket storage in local SQLite
- durable side-effect and attempt persistence
- policy-gated tool execution with approval/resume flows for risky mutations
- structured plans with explicit files, commands, verification steps, and risks
- autopilot-driven queue execution with self-audit seeding and approval handling
- a browser-based local control plane for tickets, approvals, operations, and reliability views
- startup and shutdown orchestration for the managed local stack on Windows
- reliability harnesses, SLO metrics, and published baseline/reporting flows

The current project focus is no longer "multiple ways to start the app". The supported full-stack startup path is the current Windows launcher, which handles cleanup, validation, health checks, UI startup, and autopilot orchestration in one place.

## What It Demonstrates

- Queue-driven automation through durable ticket objects
- Canonical ticket objects backed by a local SQLite task store
- Operator ticket management through `npm run tickets`
- Browser-based operator UI through `npm run ui`
- Startup preflight and policy-first task admission before queue mutation
- Structured planning contracts with intended files, commands, verification, and risks
- Typed engineering tool runtime for bounded reads, search, patch validation/application, and allowlisted commands
- Ticket-store-backed repository adapters with markdown projection and bounded fixture smoke coverage
- Repository context gathering from `package.json`, `README.md`, focused file ranking, selected file indexes, and git status
- Pluggable AI backends for GitHub Copilot CLI, OpenAI, Claude, and Ollama
- Guardrails for budget, iteration count, error thresholds, and optional auto-commit
- Persistent state tracking in `AGENT.md`
- Single-pass execution for bounded demos and CI-friendly runs

## Current Scope

Hephaestus is intentionally a local-first engineering control plane, not a general autonomous programmer. It can execute bounded read/search/patch/verification plans through the governed tool runtime, pauses for approval on risky mutations, records durable attempts and artifacts, and exports local patch bundles for developer review.

## Quick Start

```bash
# Install dependencies
npm install

# Configure environment
cp .env.example .env

# Validate configuration before launch
npm run validate:config

# Create work in the ticket store
npm run tickets -- create "Inspect the runtime flow"

# Windows full-stack startup (canonical entrypoint)
start_all.bat

# Run one bounded demo pass
npm run start:once

# Or launch the operator UI
npm run ui

# Or run in watcher mode
npm run start
```

Canonical startup path:

- Windows full stack: `start_all.bat`
- Windows full stack stop: `stop_all.bat`
- Service-level runs for development and verification: `npm run start`, `npm run start:once`, `npm run ui`
- Unix-like helper: `start.sh`

`start_all.bat` is the documented Windows entrypoint. It delegates into the current PowerShell-based startup flow and represents the supported startup path for the local stack.

## Default Demo Setup

The default `.env.example` targets the current repository:

```env
TARGET_PROJECT=.
```

That means the agent reads and reasons about this repository itself. To point it at another project, set `TARGET_PROJECT` to a different path.

## Scripts

- `npm run build` compiles the TypeScript source into `dist/`
- `start_all.bat` launches the Windows full stack with cleanup, health checks, viewers, and autopilot
- `stop_all.bat` stops the managed Windows stack and cleans up PID-tracked processes
- `npm run preflight` validates config, repo files, and backend reachability
- `npm run start` builds and starts watcher mode
- `npm run start:once` builds, processes the current queue once, and exits
- `npm run ui` starts the local UI server with REST, SSE, and the operator UI
- `npm run dev` runs the agent directly from source with `tsx`
- `npm run dev:once` runs a single-pass source-mode demo
- `npm run tickets -- <command>` creates, lists, retries, and inspects canonical tickets
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
npm run tickets -- render-board
```

## UI Access

The UI server is local-first and token-gated. By default it binds to `127.0.0.1:4180`.

If `UI_TOKENS` is unset, Hephaestus starts the UI with a local development admin token and logs that token on startup. To define explicit roles, set:

```env
UI_TOKENS=viewer:viewer-token,operator:operator-token,approver:approver-token,admin:admin-token
UI_PORT=4180
UI_HOST=127.0.0.1
UI_SSE_INTERVAL_MS=2000
```

Supported UI roles are `viewer`, `operator`, `approver`, and `admin`.

## Runtime Requirements

Hephaestus requires Node.js 22.5 or newer because the default ticket store uses `node:sqlite`.

## Tool Runtime

The typed engineering tools live behind a policy runtime. It supports bounded repository search, protected-path-aware file reads, patch dry-runs and application through `git apply`, and exact allowlisted verification commands. Branch, commit, and PR delivery remain fail-closed; the supported delivery path is a local patch bundle with manifest provenance for developer review.

## Architecture

See `docs/architecture.md` for the current runtime shape and the shift-left roadmap.

## Project Structure

```text
Hephaestus/
├── src/
│   ├── agent.ts
│   ├── config.ts
│   ├── executor.ts
│   ├── logger.ts
│   ├── memory.ts
│   ├── plan-contract.ts
│   ├── preflight.ts
│   ├── repositories.ts
│   ├── runtime.ts
│   ├── safety.ts
│   ├── types.ts
│   └── watcher.ts
├── docs/
│   └── architecture.md
├── test/
├── TASKS.md
├── AGENT.md
└── .github/workflows/ci.yml
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

## License

MIT
