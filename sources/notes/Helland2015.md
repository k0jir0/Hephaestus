# Helland2015

Citation: Helland, P. (2015). Immutability Changes Everything. Communications of the ACM, 58(1), 66-73.

Public URL or DOI: https://doi.org/10.1145/2857274.2884038
Local Copy: not present
Status: note
Blueprint Phases: D2

## Summary

- Argues that immutable facts simplify reasoning, scaling, and recovery.
- Pushes systems toward append-only records and derived projections.
- Highlights how mutable summaries are useful, but only when rooted in stable facts.
- Supports designing around historical traceability rather than overwrite-heavy workflows.

## Relevance To Hephaestus

- D2 should treat evidence as append-only facts and treat views as projections.
- Operator-facing dashboards should be renderings of durable records, not the canonical truth.
- Failure recovery becomes easier if prior actions are preserved rather than rewritten.

## Hephaestus Would Be Worse Without It

Hephaestus would be more likely to collapse evidence, state, and UI projection into one mutable surface that is harder to trust and recover.

## Acquisition Note

This should move to copy+note only through a lawful access path.
