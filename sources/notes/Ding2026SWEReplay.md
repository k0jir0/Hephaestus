# Ding2026SWEReplay

Citation: Ding, Y., and Zhang, L. (2026). SWE-Replay: Efficient Test-Time Scaling for Software Engineering Agents.

Public URL or DOI: https://arxiv.org/abs/2601.22129
Local Copy: sources/papers/40-llm-agents/Ding2026SWEReplay.pdf
Status: copy+note
Blueprint Phases: D3-D4

## Summary

- Proposes trajectory reuse and branching to reduce repeated-from-scratch sampling costs.
- Targets test-time scaling for software engineering agents with lower compute overhead.
- Avoids dependence on separate value-model estimators by using replayed trajectory structure.
- Reports improved cost-performance tradeoffs on SWE-bench variants.

## Relevance To Hephaestus

- Useful for designing bounded retry and exploration policies with evidence reuse.
- Supports D3-D4 efficiency improvements in iterative agent execution loops.
- Aligns with reducing expensive redundant attempts while preserving auditability.

## Hephaestus Would Be Worse Without It

Hephaestus would miss practical strategies for scaling agent retries without linear cost growth.

## Acquisition Note

Local copy acquired from arXiv at https://arxiv.org/pdf/2601.22129.
