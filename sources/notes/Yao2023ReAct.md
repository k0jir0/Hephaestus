# Yao2023ReAct

Citation: Yao, S., Zhao, J., Yu, D., Du, N., Shafran, I., Narasimhan, K., and Cao, Y. (2023). ReAct: Synergizing Reasoning and Acting in Language Models.

Public URL or DOI: https://arxiv.org/abs/2210.03629
Local Copy: sources/papers/40-llm-agents/Yao2023ReAct.pdf
Status: copy+note
Blueprint Phases: D3-D4

## Summary

- Combines explicit reasoning traces with external actions in iterative loops.
- Shows gains from interleaving thought and tool interaction rather than using one-shot outputs.
- Highlights the importance of action observability in agent loops.
- Provides a conceptual template for reasoning-action coordination.

## Relevance To Hephaestus

- Aligns with bounded plan-and-execute flows where tool interactions are first-class evidence.
- Supports D3-D4 design of planner/runtime interfaces and action trace artifacts.
- Helps distinguish intentional action sequences from opaque model output.

## Hephaestus Would Be Worse Without It

Hephaestus would have less grounding for designing interpretable reasoning-action loops in autonomous execution.

## Acquisition Note

Local copy acquired from arXiv at https://arxiv.org/pdf/2210.03629.
