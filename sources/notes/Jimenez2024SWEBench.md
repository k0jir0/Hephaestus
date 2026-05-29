# Jimenez2024SWEBench

Citation: Jimenez, C. E., Yang, J., Wettig, A., Yao, S., Pei, K., Press, O., and Narasimhan, K. (2024). SWE-bench: Can Language Models Resolve Real-World GitHub Issues?

Public URL or DOI: https://arxiv.org/abs/2310.06770
Local Copy: sources/papers/40-llm-agents/Jimenez2024SWEBench.pdf
Status: copy+note
Blueprint Phases: D3-D4

## Summary

- Defines a realistic benchmark based on real GitHub issues and corresponding patches.
- Emphasizes repository context, execution environments, and multi-file change coordination.
- Demonstrates that software-engineering evaluation is materially harder than snippet-level code generation.
- Gives a concrete benchmark lens for measuring agent usefulness rather than relying on anecdotes.

## Relevance To Hephaestus

- Provides a grounding benchmark for issue-to-fix workflows similar to Hephaestus task execution.
- Supports decisions about context gathering, environment contracts, and patch verification.
- Helps D3-D4 keep evaluation tied to realistic repository work rather than toy tasks.

## Hephaestus Would Be Worse Without It

Hephaestus would have less disciplined benchmarking for whether its autonomy model actually helps on realistic engineering work.

## Acquisition Note

Local copy acquired from arXiv at https://arxiv.org/pdf/2310.06770.
