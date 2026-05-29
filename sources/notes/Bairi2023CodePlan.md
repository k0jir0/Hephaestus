# Bairi2023CodePlan

Citation: Bairi, R., Sonwane, A., Kanade, A., D C, V., Iyer, A., Parthasarathy, S., Rajamani, S., and Ashok, B. (2023). CodePlan: Repository-level Coding using LLMs and Planning.

Public URL or DOI: https://arxiv.org/abs/2309.12499
Local Copy: sources/papers/40-llm-agents/Bairi2023CodePlan.pdf
Status: copy+note
Blueprint Phases: D3-D4

## Summary

- Treats repository-level coding as a planning problem over interdependent edits.
- Uses incremental dependency and impact analysis to guide edit sequencing.
- Demonstrates gains over non-planning baselines on multi-file repository tasks.
- Emphasizes context selection and edit ordering as first-class quality factors.

## Relevance To Hephaestus

- Strong grounding for planner design when tasks require coordinated multi-file updates.
- Supports explicit execution plans and context derivation policies in D3-D4.
- Connects repository analysis with safe staged mutation.

## Hephaestus Would Be Worse Without It

Hephaestus would have weaker foundations for designing deterministic plan steps in large, interdependent repositories.

## Acquisition Note

Local copy acquired from arXiv at https://arxiv.org/pdf/2309.12499.
