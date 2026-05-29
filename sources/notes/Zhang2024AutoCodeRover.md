# Zhang2024AutoCodeRover

Citation: Zhang, Y., Ruan, H., Fan, Z., and Roychoudhury, A. (2024). AutoCodeRover: Autonomous Program Improvement.

Public URL or DOI: https://arxiv.org/abs/2404.05427
Local Copy: sources/papers/40-llm-agents/Zhang2024AutoCodeRover.pdf
Status: copy+note
Blueprint Phases: D3-D4

## Summary

- Uses structured code search, program representation, and test-guided localization to solve GitHub issues.
- Emphasizes software-engineering structure rather than treating repositories as flat text.
- Connects retrieval quality directly to downstream patch quality.
- Shows a lower-cost, software-engineering-oriented route to issue resolution.

## Relevance To Hephaestus

- Strongly supports context retrieval, localization, and verification as first-class architectural concerns.
- Useful for designing repository search and issue-localization policy in D3-D4.
- Reinforces the value of combining semantic planning with structural code understanding.

## Hephaestus Would Be Worse Without It

Hephaestus would have less grounding for repository search and issue-localization strategies that are more software-engineering aware than generic prompt stuffing.

## Acquisition Note

Local copy acquired from arXiv at https://arxiv.org/pdf/2404.05427.
