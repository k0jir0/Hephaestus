# Verraes2019

Citation: Verraes, G., and Vernon, V. (2019). Event Sourcing. Queue, 17(1).

Public URL or DOI: pending verification
Local Copy: not present
Status: note
Blueprint Phases: D2

## Summary

- Gives practical language for event streams, projections, and replay-oriented design.
- Clarifies the difference between facts that happened and read models built later.
- Helps teams discuss event-first architectures without overloading database terminology.
- Emphasizes that projections are disposable and rebuildable.

## Relevance To Hephaestus

- D2 needs a shared vocabulary for event records, evidence records, and reconstructed views.
- The cockpit should be treated as a projection layer over durable history.
- Replay logic becomes easier to discuss when facts and views are cleanly separated.

## Hephaestus Would Be Worse Without It

Hephaestus would keep re-arguing basic event and projection concepts instead of applying them consistently.

## Acquisition Note

This entry needs a verified public landing page before it is considered fully grounded.
