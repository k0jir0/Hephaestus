# New Research Acquisition Shortlist (Top 12)

Scope: New targets only. Excludes currently indexed active catalog papers.
Goal: Find high-leverage papers that improve roadmap phases without duplicating existing sources.
Date: 2026-06-02

## Selection Rules

1. Paper must map to a specific roadmap gap (P2-P8).
2. Paper must provide empirical results or formal method detail, not opinion only.
3. Paper must include explicit reproducibility or threat-to-validity discussion when possible.
4. Each accepted paper must trigger at least one concrete roadmap refinement.

## Ranked Targets

### 1) Runtime Verification for Autonomous Pipelines
- Priority: P0
- Why now: Directly upgrades formal invariants and hard gates.
- Roadmap impact: Phase 1, Phase 5, Phase 8
- Search query:
  - "runtime verification autonomous agents temporal logic monitor synthesis software pipelines"
- Acceptance criteria:
  - Includes machine-checkable property specification approach
  - Includes deployment or evaluation context beyond toy examples
  - Shows monitoring overhead or false alarm tradeoff
- Expected deliverable impact:
  - Add monitor architecture to invariants section
  - Add CI/runtime property checks beyond unit tests

### 2) Causal Incident Analysis for Autonomous Systems
- Priority: P0
- Why now: Improves incident quality and policy threshold tuning.
- Roadmap impact: Phase 2, Phase 3, Phase 8
- Search query:
  - "causal inference incident analysis autonomous systems reliability"
- Acceptance criteria:
  - Uses causal graph or structured causal attribution
  - Distinguishes correlation from causal mechanism
  - Includes operational case study or simulation
- Expected deliverable impact:
  - Upgrade incident schema with causal fields
  - Add threshold-change justification protocol

### 3) Human-on-the-Loop Intervention Timing
- Priority: P0
- Why now: Prevents over-gating and overtrust in approval flow.
- Roadmap impact: Phase 3, Phase 7
- Search query:
  - "human-on-the-loop intervention timing automation trust calibration"
- Acceptance criteria:
  - Quantifies intervention latency vs error tradeoff
  - Includes operator workload or alert fatigue metrics
- Expected deliverable impact:
  - Add operator burden KPI and gate timing policy

### 4) Constrained Autonomy / Safe Policy Optimization
- Priority: P0
- Why now: Formalizes risk-tier behavior under constraints.
- Roadmap impact: Phase 3, Phase 8
- Search query:
  - "constrained policy optimization safe reinforcement learning hard constraints"
- Acceptance criteria:
  - Hard safety constraint mechanism, not soft preference only
  - Evaluation includes safety violation rates
- Expected deliverable impact:
  - Formal risk-tier policy profile with safety bounds

### 5) Modern Saga/Compensation Patterns at Scale
- Priority: P1
- Why now: Deepens checkpoint and rollback contract quality.
- Roadmap impact: Phase 4, Phase 6
- Search query:
  - "saga orchestration compensating transactions cloud-native reliability"
- Acceptance criteria:
  - Discusses irreversible side effects and compensation semantics
  - Includes consistency and recovery timing implications
- Expected deliverable impact:
  - Compensation policy table by side-effect class

### 6) Long-Horizon Software Agent Benchmarking
- Priority: P1
- Why now: Prevents overfitting to one benchmark surface.
- Roadmap impact: Phase 5
- Search query:
  - "long-horizon software engineering agent benchmark reproducibility"
- Acceptance criteria:
  - Multi-step issue workflow, repository context, and execution constraints
  - Reports confidence intervals or robust comparative statistics
- Expected deliverable impact:
  - Benchmark protocol extension in evidence contract

### 7) Property-Based Testing for Stateful Distributed Workflows
- Priority: P1
- Why now: Extends current invariant testing into distributed behaviors.
- Roadmap impact: Phase 1, Phase 2, Phase 4
- Search query:
  - "property-based testing stateful distributed systems invariants"
- Acceptance criteria:
  - Generator/shrinker strategy for state transition systems
  - Example of finding non-trivial edge cases in production-like logic
- Expected deliverable impact:
  - Add property-test suite template for lifecycle/recovery

### 8) Progressive Delivery and Automated Rollback Governance
- Priority: P1
- Why now: Strengthens promotion policy profiles and safe rollout.
- Roadmap impact: Phase 6, Phase 8
- Search query:
  - "progressive delivery automated rollback policy gates"
- Acceptance criteria:
  - Defines promotion guard conditions and rollback triggers
  - Includes measurable canary/health gate outcomes
- Expected deliverable impact:
  - Promotion profile criteria with release-stage gates

### 9) Decision-Centric Explainability for Operations
- Priority: P1
- Why now: Improves operator actionability, not just model transparency.
- Roadmap impact: Phase 3, Phase 7
- Search query:
  - "operational decision support explainability counterfactual recommendations"
- Acceptance criteria:
  - Measures explanation usefulness for operator decisions
  - Compares explanation modalities or confidence calibration
- Expected deliverable impact:
  - Approval UI evidence format with decision-quality checks

### 10) Multi-Objective Optimization for Throughput-Safety Tradeoffs
- Priority: P2
- Why now: Helps tune autonomy budgets and gate strictness quantitatively.
- Roadmap impact: Phase 2, Phase 3, Phase 8
- Search query:
  - "multi-objective optimization reliability safety throughput automation"
- Acceptance criteria:
  - Explicit Pareto or constrained optimization method
  - Includes practical tuning guidance under changing load
- Expected deliverable impact:
  - Budget profile tuner and policy threshold dashboard

### 11) Socio-Technical Incident Response for Autonomous DevOps
- Priority: P2
- Why now: Makes on-call and runbook plans more realistic.
- Roadmap impact: Phase 8
- Search query:
  - "socio-technical incident response autonomous operations"
- Acceptance criteria:
  - Human-automation coordination model in incidents
  - Runbook/alert design recommendations with evidence
- Expected deliverable impact:
  - Incident response schema and drill cadence upgrades

### 12) Cost-Risk Economics of Autonomy
- Priority: P2
- Why now: Supports leadership decisions on strict vs permissive operation.
- Roadmap impact: Phase 8 and governance board reviews
- Search query:
  - "economics of automation risk cost reliability software operations"
- Acceptance criteria:
  - Quantitative model of gains vs risk/cost burden
  - Sensitivity analysis across operating regimes
- Expected deliverable impact:
  - Executive KPI section for policy profile selection

## Acquisition Workflow

1. Run search query in Google Scholar / arXiv / ACM / IEEE / Springer / USENIX.
2. Record top 5 candidates per target in a temporary shortlist table.
3. Keep one primary and one backup source per target after quality review.
4. Add selected source to:
   - `sources/sources.txt`
   - `sources/library-catalog.md`
   - `sources/acquisition-manifest.md`
   - `sources/notes/<Key>.md`
5. Store local PDF only if open access or lawfully licensed.

## Quality Gate Before Indexing

- Must be new (not currently indexed active source)
- Must map to at least one roadmap item and KPI
- Must include one sentence: "How this source changed a concrete design choice"

## Suggested First 3 to Acquire This Week

1. Runtime verification for autonomous pipelines
2. Human-on-the-loop intervention timing
3. Progressive delivery and automated rollback governance
