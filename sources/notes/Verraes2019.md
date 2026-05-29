# Verraes2019

Citation: Verraes, G., and Vernon, V. (2019). Event Sourcing. Queue, 17(1).

Public URL or DOI: pending verification
Local Copy: not present
Status: quarantine
Blueprint Phases: D2

Audit note: this citation could not be validated on 2026-05-29. ACM Queue
volume 17 issue 1 exists, but the relevant event-log article found there is
`Online Event Processing` by Martin Kleppmann, Alastair R. Beresford, and
Boerge Svingen, not a Verraes/Vernon paper titled `Event Sourcing`.

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

This entry must not ground design work until a verified public landing page is found. If no such page is found, replace it with a verified source such as Martin Fowler's `Event Sourcing`, Kleppmann et al.'s `Online Event Processing`, or another real event-sourcing source.
