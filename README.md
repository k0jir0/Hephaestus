# Hephaestus

Hephaestus is a self-targeting AI automation demo. It keeps canonical task state in a local ticket store, optionally projects that state back into `TASKS.md` for inspection, gathers repository context, sends work to a configurable AI backend, and records state transitions in markdown so the workflow stays inspectable.

This repository is configured to run Hephaestus on itself by default. That makes it useful as a GitHub-ready demo of AI automation with visible guardrails instead of an opaque “magic agent” claim.

## What It Demonstrates

- Queue-driven automation through `TASKS.md`
- Canonical ticket objects backed by a local SQLite task store
- Operator ticket management through `npm run tickets`
- Startup preflight and policy-first task admission before queue mutation
- Structured planning contracts with intended files, commands, verification, and risks
- Ticket-store-backed repository adapters with markdown projection and bounded fixture smoke coverage
- Repository context gathering from `package.json`, `README.md`, and git status
- Pluggable AI backends for GitHub Copilot CLI, OpenAI, Claude, and Ollama
- Guardrails for budget, iteration count, error thresholds, and optional auto-commit
- Persistent state tracking in `AGENT.md`
- Single-pass execution for bounded demos and CI-friendly runs

## Current Scope

Hephaestus is intentionally a safe demo project. It orchestrates tasks and records typed execution plans, but it does not yet apply code edits through a sandboxed tool runtime. That keeps the automation flow auditable while still exposing the plan the agent intends to follow.

## Quick Start

```bash
# Install dependencies
npm install

# Configure environment
cp .env.example .env

# Validate the environment and repo shape
npm run preflight

# Create work in the ticket store
npm run tickets -- create "Inspect the runtime flow"

# Run one bounded demo pass
npm run start:once

# Or run in watcher mode
npm run start
```

On Windows, you can also use `start.bat`. On Unix-like systems, use `start.sh`.

## Default Demo Setup

The default `.env.example` targets the current repository:

```env
TARGET_PROJECT=.
```

That means the agent reads and reasons about this repository itself. To point it at another project, set `TARGET_PROJECT` to a different path.

## Scripts

- `npm run build` compiles the TypeScript source into `dist/`
- `npm run preflight` validates config, repo files, and backend reachability
- `npm run start` builds and starts watcher mode
- `npm run start:once` builds, processes the current queue once, and exits
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

If a task fails after it has already moved into `In Progress`, Hephaestus now moves it into a `Blocked` section instead of leaving it stranded. That keeps the queue accurate and makes operator follow-up explicit.

`TASKS.md` is now an optional projection, not the canonical source of truth. Hephaestus stores durable ticket state in `TICKETS_DB_FILE` and rewrites the markdown board from that store when projection is available. New work should be created through the ticket CLI rather than by editing markdown.

When a task is admitted, the executor now returns a structured plan instead of only free-form prose. Each successful plan contains:

- intended file targets
- intended commands
- verification steps
- risk notes

The runtime now talks to explicit task and memory repository interfaces. The default task implementation uses a local SQLite ticket store with markdown projection, and falls back to markdown-only behavior when SQLite is unavailable.

## Ticket CLI

```bash
npm run tickets -- create "Add a retry policy"
npm run tickets -- list --status blocked
npm run tickets -- show ticket_abc123
npm run tickets -- retry ticket_abc123
npm run tickets -- render-board
```

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
