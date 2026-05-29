# Tao2024MAGIS

Citation: Tao, W., Zhou, Y., Wang, Y., Zhang, W., Zhang, H., and Cheng, Y. (2024). MAGIS: LLM-Based Multi-Agent Framework for GitHub Issue Resolution.

Public URL or DOI: https://arxiv.org/abs/2403.17927
Local Copy: sources/papers/40-llm-agents/Tao2024MAGIS.pdf
Status: copy+note
Blueprint Phases: D3-D4

## Summary

- Proposes a multi-agent workflow for repository-scale GitHub issue resolution.
- Decomposes work into manager, repository, developer, and QA agent roles.
- Frames issue resolution as coordinated planning, coding, and validation rather than one-shot generation.
- Reports stronger benchmark outcomes than direct single-agent prompting baselines.

## Relevance To Hephaestus

- Useful reference for role separation across planning, execution, and verification boundaries.
- Supports D3-D4 design choices around explicit stage and responsibility decomposition.
- Helps evaluate when multi-agent orchestration is worth its added complexity.

## Hephaestus Would Be Worse Without It

Hephaestus would have less evidence for comparing structured multi-agent orchestration against simpler runtime designs.

## Acquisition Note

Local copy acquired from arXiv at https://arxiv.org/pdf/2403.17927.
