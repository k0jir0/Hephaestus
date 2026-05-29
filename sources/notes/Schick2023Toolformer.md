# Schick2023Toolformer

Citation: Schick, T., Dwivedi-Yu, J., Dessi, R., et al. (2023). Toolformer: Language Models Can Teach Themselves to Use Tools.

Public URL or DOI: http://arxiv.org/abs/2302.04761v1
Local Copy: sources/papers/40-llm-agents/Schick2023Toolformer.pdf
Status: copy+note
Blueprint Phases: D3

## Summary

- Frames tool use as a learned part of problem solving rather than a bolt-on afterthought.
- Reinforces that tool choice and argument quality matter as much as free-form reasoning.
- Encourages explicit tool interfaces and predictable outputs.
- Helps separate model cognition from environment interaction contracts.

## Relevance To Hephaestus

- The command catalog and governed tool runtime need crisp, typed boundaries.
- D3 should keep tool invocation policy explicit and inspectable.
- Evidence should capture not just what the model thought, but which tool interactions actually happened.

## Hephaestus Would Be Worse Without It

Hephaestus could treat tool use as ad hoc prompt magic instead of a governed execution layer.

## Acquisition Note

This is a stocked open-access local copy and belongs in active tool-runtime design work.
