# Yang2024SWEAgent

Citation: Yang, J., Jimenez, C. E., Wettig, A., Yao, S., Pei, K., and Narasimhan, K. (2024). SWE-agent: Agent-Computer Interfaces Enable Automated Software Engineering.

Public URL or DOI: http://arxiv.org/abs/2405.15793v3
Local Copy: sources/papers/40-llm-agents/Yang2024SWEAgent.pdf
Status: copy+note
Blueprint Phases: D3-D4

## Summary

- Treats software engineering agents as environment-coupled systems rather than pure text generators.
- Makes terminal, file edits, and test feedback central to agent performance.
- Shows that interface design and tool affordances strongly affect agent outcomes.
- Grounds evaluation in real issue-resolution loops rather than abstract coding snippets.

## Relevance To Hephaestus

- Hephaestus should define clear execution contracts for inspect, edit, verify, and approval flows.
- Runtime architecture should preserve environment feedback as first-class evidence.
- D3-D4 can use this to shape planner/runtime boundaries and agent-computer interfaces.

## Hephaestus Would Be Worse Without It

Hephaestus could overfocus on model prompting and underinvest in the execution interface that actually determines agent behavior.

## Acquisition Note

This is a stocked open-access local copy and should stay in the active set.
