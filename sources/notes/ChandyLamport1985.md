# ChandyLamport1985

Citation: Chandy, K. M., and Lamport, L. (1985). Distributed Snapshots: Determining Global States of Distributed Systems. ACM Transactions on Computer Systems, 3(1), 63-75.

Public URL or DOI: https://doi.org/10.1145/214451.214456
Local Copy: not present
Status: note
Blueprint Phases: D2

## Summary

- Defines a consistent way to reconstruct a distributed global state without stopping the whole system.
- Separates the event stream from the later act of state reconstruction.
- Shows that replay and audit require explicit capture boundaries, not informal logging.
- Makes hidden in-flight work visible as part of the reconstructed state.

## Relevance To Hephaestus

- D2 needs durable event and evidence records that support later reconstruction.
- Approval, retry, and completion reasoning should be explainable from recorded facts, not inferred from mutable current state alone.
- The control plane will need a stable notion of what the system knew at a given moment.

## Hephaestus Would Be Worse Without It

Hephaestus would risk mixing current projections with historical truth and would lack a disciplined replay model for audit and debugging.

## Acquisition Note

A verified local copy path is still needed before this entry can become copy+note.
