# Xia2024Agentless

Citation: Xia, C. S., Deng, Y., Dunn, S., and Zhang, L. (2024). Agentless: Demystifying LLM-based Software Engineering Agents.

Public URL or DOI: https://arxiv.org/abs/2407.01489
Local Copy: sources/papers/40-llm-agents/Xia2024Agentless.pdf
Status: copy+note
Blueprint Phases: D3-D4

## Summary

- Argues that simpler, more interpretable workflows can outperform more elaborate software-engineering agents.
- Breaks the workflow into localization, repair, and patch validation instead of open-ended agent planning.
- Shows strong results on SWE-bench Lite with lower cost and less operational complexity.
- Reframes the baseline: more autonomy is not automatically better autonomy.

## Relevance To Hephaestus

- Important counterweight against overcomplicating the planner/runtime split.
- Supports the case for explicit stages, tight interfaces, and interpretable bounded workflows.
- Gives D3-D4 a benchmark for when simple execution contracts may beat more agentic orchestration.

## Hephaestus Would Be Worse Without It

Hephaestus would risk assuming that more tool-mediated agency is inherently superior to simpler governed workflows.

## Acquisition Note

Local copy acquired from arXiv at https://arxiv.org/pdf/2407.01489.
