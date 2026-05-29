# Shinn2023Reflexion

Citation: Shinn, N., Cassano, F., Labash, B., and Gopinath, A. (2023). Reflexion: Language Agents with Verbal Reinforcement Learning.

Public URL or DOI: http://arxiv.org/abs/2303.11366v4
Local Copy: sources/papers/40-llm-agents/Shinn2023Reflexion.pdf
Status: copy+note
Blueprint Phases: D3-D4

## Summary

- Uses structured self-critique to improve later attempts.
- Suggests reflection is useful when it is bounded, captured, and tied to observed outcomes.
- Encourages learning from failed attempts without giving the agent unlimited freedom to loop.
- Shows why retry policy and reflection policy should be connected.

## Relevance To Hephaestus

- Retry and critique loops should be explicit policies with durable evidence.
- D3-D4 can use reflection as a bounded mechanism, not a free-form excuse for repeated retries.
- The system should preserve what was learned from failure in operator-readable form.

## Hephaestus Would Be Worse Without It

Hephaestus could either omit useful reflection entirely or allow unbounded retry loops that produce noise without progress.

## Acquisition Note

This is a stocked open-access local copy and should inform bounded retry design.
