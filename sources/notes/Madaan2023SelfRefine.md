# Madaan2023SelfRefine

Citation: Madaan, A., Tandon, N., Gupta, P., Hallinan, S., Gao, L., Wiegreffe, S., Alon, U., Dziri, N., Prabhumoye, S., Yang, Y., Gupta, S., Shah, A., Hu, J., Yavuz, S., and Clark, P. (2023). Self-Refine: Iterative Refinement with Self-Feedback.

Public URL or DOI: https://arxiv.org/abs/2303.17651
Local Copy: sources/papers/40-llm-agents/Madaan2023SelfRefine.pdf
Status: copy+note
Blueprint Phases: D3-D4

## Summary

- Proposes iterative feedback and refinement using the same model rather than separate training or reinforcement stages.
- Shows that refinement can improve outputs when the system makes feedback explicit and reuses it in later attempts.
- Treats critique as a structured step in the execution loop rather than a vague prompt flourish.
- Suggests improvement can happen at inference time with bounded extra passes.

## Relevance To Hephaestus

- Supports bounded self-critique and repair loops after planning or execution failures.
- Reinforces that feedback artifacts should be explicit and persisted if they are going to shape retries.
- Helps D3-D4 distinguish useful refinement from uncontrolled repetition.

## Hephaestus Would Be Worse Without It

Hephaestus would have weaker guidance for when reflection is useful and when repeated attempts are just churn.

## Acquisition Note

Local copy acquired from arXiv at https://arxiv.org/pdf/2303.17651.
