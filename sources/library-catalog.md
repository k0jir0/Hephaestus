# Hephaestus Research Catalog

This file is the operational catalog for the Hephaestus research library. Use it
to track what is merely cited, what is locally present, and what has already
been converted into project-usable notes.

## Status Legend

- `cite-only`: source is listed, but no local note exists yet
- `note`: source has a local project note
- `copy+note`: source has a lawful local copy and a note
- `deferred`: source is worth keeping on the backlog but is not active

## Implemented Library Snapshot

- notes now live under `sources/notes/`
- lawful local copies now live under `sources/papers/`
- the working inventory is tracked in `sources/acquisition-manifest.md`
- the active library currently includes notes for every source in the active catalog
- five open-access papers are now stocked locally as `copy+note`

## Active Catalog

| Key | Domain | Why It Matters | Phase | Target Status | Current Status |
| --- | --- | --- | --- | --- | --- |
| `ChandyLamport1985` | event reconstruction | snapshots, replay, state reconstruction | `D2` | `copy+note` | `copy+note` |
| `Helland2015` | immutability and evidence | append-only event thinking and projections | `D2` | `copy+note` | `note` |
| `Verraes2019` | event sourcing vocabulary | event stream vs projection language | `D2` | `note` | `note` |
| `Endsley1995` | operator awareness | approval queues, cockpit clarity, state visibility | `D6` | `note` | `note` |
| `LeeSee2004` | trust in automation | escalation thresholds and approval boundaries | `D3-D6` | `note` | `note` |
| `Woods1996` | automation complexity | autopilot restraint and control-plane realism | `D3-D6` | `note` | `note` |
| `Yang2024SWEAgent` | software agents | repo-bound agent workflow and execution contracts | `D3-D4` | `copy+note` | `copy+note` |
| `Jimenez2024SWEBench` | benchmark evaluation | realistic issue-to-fix evaluation and environment grounding | `D3-D4` | `copy+note` | `copy+note` |
| `Zhang2023RepoCoder` | repository context | retrieval and repository-scoped context shaping | `D3` | `copy+note` | `copy+note` |
| `Zhang2024AutoCodeRover` | structured localization | issue localization, code search, and software-engineering-oriented repair | `D3-D4` | `copy+note` | `copy+note` |
| `Schick2023Toolformer` | tool use | tool invocation policy and command catalog design | `D3` | `copy+note` | `copy+note` |
| `Shinn2023Reflexion` | self-critique loops | bounded reflection and retry heuristics | `D3-D4` | `copy+note` | `copy+note` |
| `Madaan2023SelfRefine` | self-feedback loops | bounded refinement after action | `D3-D4` | `copy+note` | `copy+note` |
| `Xia2024Agentless` | workflow simplicity | interpretable non-agentic baseline for software issue resolution | `D3-D4` | `copy+note` | `copy+note` |
| `Yao2023ReAct` | reasoning-action loops | interleaved reasoning and tool actions with observable traces | `D3-D4` | `copy+note` | `copy+note` |
| `Tao2024MAGIS` | multi-agent orchestration | role-based collaboration for repository issue resolution | `D3-D4` | `copy+note` | `copy+note` |
| `Bairi2023CodePlan` | repository planning | multi-step repository edit planning with dependency-aware sequencing | `D3-D4` | `copy+note` | `copy+note` |
| `Liu2024STALLPlus` | static-analysis integration | combines static analysis and retrieval for repo-level completion | `D3-D4` | `copy+note` | `copy+note` |
| `Ding2026SWEReplay` | test-time scaling | trajectory replay and branching for efficient SWE-agent scaling | `D3-D4` | `copy+note` | `copy+note` |
| `Helland2007LifeBeyondDistributedTransactions` | distributed workflow reliability | compensation-driven reliability over global transaction assumptions | `D2-D5` | `copy+note` | `copy+note` |
| `Amodei2016` | AI safety | autonomy failure modes and misoptimization risk | `D3-D5` | `copy+note` | `copy+note` |
| `ClaessenHughes2000` | property-based verification | invariants and high-coverage policy testing | `D1-D5` | `copy+note` | `copy+note` |
| `LevesonThomas2018STPAHandbook` | systems safety analysis | unsafe control action analysis for autonomy and oversight | `D3-D6` | `copy+note` | `copy+note` |
| `FooteYoder1997BigBallOfMud` | architecture complexity control | complexity drift and modularity discipline under growth | `D1-D4` | `copy+note` | `copy+note` |

## Next Backlog Tier

| Key | Domain | Why It Matters | Phase | Target Status |
| --- | --- | --- | --- | --- |
| `Ousterhout2018` | software design | complexity control and module boundaries | `D1-D4` | `note` |
| `Lamport2002` | formal specification | invariants, replay safety, and promotion rules | `D2-D5` | `note` |

## Intake Checklist

When a paper is added to the active library:

1. Add the citation to `sources.txt` if it belongs in the canonical bibliography.
2. Add or update an entry in this catalog.
3. Create or update the local note in `sources/notes/`.
4. Mark which blueprint phase or design problem the paper informs.
5. Write one sentence explaining why Hephaestus would be worse without it.

## Removal Checklist

Demote a paper from the active set when:

1. it no longer informs an active blueprint phase
2. a stronger or more directly applicable source replaces it
3. the note is stale and nobody refers to it in design work

If demoted, do not delete the citation immediately; move it to deferred status and
leave a short reason.