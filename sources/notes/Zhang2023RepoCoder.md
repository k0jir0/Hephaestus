# Zhang2023RepoCoder

Citation: Zhang, Y., Li, C., Sun, J., et al. (2023). RepoCoder: Repository-Level Code Completion Through Iterative Retrieval and Generation.

Public URL or DOI: http://arxiv.org/abs/2303.12570v3
Local Copy: sources/papers/40-llm-agents/Zhang2023RepoCoder.pdf
Status: copy+note
Blueprint Phases: D3

## Summary

- Focuses on repository-scale context rather than isolated files.
- Uses iterative retrieval and generation instead of a single monolithic prompt.
- Suggests that code quality depends heavily on choosing the right surrounding context.
- Supports context gathering as an explicit subsystem rather than an incidental prompt detail.

## Relevance To Hephaestus

- Hephaestus needs disciplined repository search and bounded context assembly.
- D3 should define how planners discover the minimum context needed for a change.
- Retrieval policy belongs in architecture, not just in model prompts or heuristics.

## Hephaestus Would Be Worse Without It

Hephaestus would be more likely to gather either too little context to act safely or too much context to stay efficient.

## Acquisition Note

This is a stocked open-access local copy and should be referenced in context-policy design.
