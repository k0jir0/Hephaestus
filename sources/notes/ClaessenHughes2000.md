# ClaessenHughes2000

Citation: Claessen, K., and Hughes, J. (2000). QuickCheck: A Lightweight Tool for Random Testing of Haskell Programs. ICFP 2000.

Public URL or DOI: https://doi.org/10.1145/351240.351266
Local Copy: not present
Status: note
Blueprint Phases: D1-D5

## Summary

- Promotes property-based testing over narrow example-only testing.
- Focuses on invariants, generators, and shrinking failing cases.
- Helps find edge cases in state machines and policy logic that normal tests miss.
- Encourages specifying behavior in terms of durable properties.

## Relevance To Hephaestus

- Ticket lifecycle, attempt lifecycle, retry policy, and replay invariants all fit property-based methods well.
- D1 already benefits from this style; D2-D5 will need it even more.
- Randomized invariant checks can harden policy modules without coupling them to runtime noise.

## Hephaestus Would Be Worse Without It

Hephaestus would rely too heavily on scenario tests and miss the broader invariant surface of its domain policies.

## Acquisition Note

A lawful local copy is still desirable, but the note is immediately actionable.
