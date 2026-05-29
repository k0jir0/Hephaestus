# Helland2007LifeBeyondDistributedTransactions

Citation: Helland, P. (2007). Life beyond Distributed Transactions: An Apostate's Opinion. CIDR 2007, 132-141.

Public URL or DOI: https://www.cidrdb.org/cidr2007/papers/cidr07p15.pdf
Local Copy: sources/papers/20-event-evidence/Helland2007LifeBeyondDistributedTransactions.pdf
Status: copy+note
Blueprint Phases: D2-D5

## Summary

- Argues that distributed systems should avoid pretending global transactions scale cleanly across boundaries.
- Encourages compensation and workflow-oriented reliability instead of strict distributed commit assumptions.
- Frames eventual consistency and workflow decomposition as practical engineering tradeoffs.
- Supports robust recovery thinking in long-running autonomous workflows.

## Relevance To Hephaestus

- Useful for designing ticket/attempt workflows and recovery semantics across partial failures.
- Helps D2-D5 treat evidence, retries, and compensation as explicit policy concerns.
- Reinforces bounded autonomy under real distributed constraints.

## Hephaestus Would Be Worse Without It

Hephaestus would be more likely to rely on brittle all-or-nothing assumptions for multi-step autonomous work.

## Acquisition Note

Local copy acquired from the CIDR public proceedings PDF at https://www.cidrdb.org/cidr2007/papers/cidr07p15.pdf.
