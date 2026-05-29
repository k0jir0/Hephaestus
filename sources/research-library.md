# Hephaestus Research Library

## Current Coverage

The existing bibliography in `sources.txt` is already strong on:

- software architecture foundations
- self-adaptive systems
- automation and human factors
- transaction and recovery thinking
- workflow modeling
- core safety framing

The main gaps are:

- event and evidence reconstruction for D2
- operator trust, explainability, and situation awareness
- repository-scale LLM coding agents
- tool-use and self-critique loops for agent design
- verification-oriented testing methods for autonomous mutation systems

## Recommendation

It is **not sufficient to keep links only** for the highest-value sources.

For Hephaestus development, the best policy is:

1. Keep a stable citation and public landing link for every source.
2. Keep a local PDF copy for open-access or lawfully licensed papers that are likely to be cited repeatedly in design work.
3. Keep a one-page local note for every important source, even when the PDF cannot be stored locally.

That means the practical rule should be:

- `link only` is acceptable for low-priority or paywalled papers you rarely revisit
- `link + local note` is the minimum for important paywalled work
- `link + local PDF + local note` is the target for core open-access work

Do **not** store unauthorized copies of copyrighted PDFs on the drive. If a paper is paywalled, keep the citation, DOI, landing page, and your own notes unless you have a legitimate licensed copy.

## Priority A: Core Papers To Add Now

### Event, Replay, and Evidence

- `[ChandyLamport1985]` Chandy, K. M., and Lamport, L. (1985). `Distributed Snapshots: Determining Global States of Distributed Systems.` ACM Transactions on Computer Systems, 3(1), 63-75.
  Relevance: important for D2 replay, reconstruction, and stable audit-state thinking.
  Acquisition: local copy preferred.

- `[Helland2015]` Helland, P. (2015). `Immutability Changes Everything.` Communications of the ACM, 58(1), 66-73.
  Relevance: frames append-only evidence, event logs, and projection thinking well for Hephaestus.
  Acquisition: local copy preferred if licensed or open through your access path.

- `[Verraes2019]` Verraes, G., and Vernon, V. (2019). `Event Sourcing.` Queue, 17(1).
  Relevance: not the only way to build D2, but useful for vocabulary around canonical events and projections.
  Acquisition: local copy preferred.

### Human Oversight and Control Plane Design

- `[Endsley1995]` Endsley, M. R. (1995). `Toward a Theory of Situation Awareness in Dynamic Systems.` Human Factors, 37(1), 32-64.
  Relevance: directly useful for cockpit/operator UI design and approval workflows.
  Acquisition: local note required; local copy preferred if licensed.

- `[LeeSee2004]` Lee, J. D., and See, K. A. (2004). `Trust in Automation: Designing for Appropriate Reliance.` Human Factors, 46(1), 50-80.
  Relevance: core paper for deciding when Hephaestus should auto-act, escalate, or require explicit approval.
  Acquisition: local note required; local copy preferred if licensed.

- `[Woods1996]` Woods, D. D. (1996). `Decomposing Automation: Apparent Simplicity, Real Complexity.` In Parasuraman and Mouloua, Automation and Human Performance.
  Relevance: useful counterweight against over-centralized “autopilot” abstractions.
  Acquisition: link plus note if no licensed copy is available.

### LLM Coding Agents and Tool Use

- `[Yang2024SWEAgent]` Yang, J., Jimenez, C. E., Wettig, A., Yao, S., Pei, K., and Narasimhan, K. (2024). `SWE-agent: Agent-Computer Interfaces Enable Automated Software Engineering.`
  Relevance: highly relevant to issue-to-fix loops, environment contracts, and benchmark framing.
  Acquisition: local copy preferred.

- `[Zhang2023RepoCoder]` Zhang, Y., Li, C., Sun, J., et al. (2023). `RepoCoder: Repository-Level Code Completion Through Iterative Retrieval and Generation.`
  Relevance: directly relevant to Hephaestus context gathering and repository-scoped planning.
  Acquisition: local copy preferred.

- `[Schick2023Toolformer]` Schick, T., Dwivedi-Yu, J., Dessì, R., et al. (2023). `Toolformer: Language Models Can Teach Themselves to Use Tools.`
  Relevance: useful for thinking about command catalogs, tool selection, and planner/runtime boundaries.
  Acquisition: local copy preferred.

- `[Shinn2023Reflexion]` Shinn, N., Cassano, F., Labash, B., and Gopinath, A. (2023). `Reflexion: Language Agents with Verbal Reinforcement Learning.`
  Relevance: strong fit for bounded critique/retry loops and post-attempt reflection.
  Acquisition: local copy preferred.

### Safety and Assurance for Autonomous Coding Systems

- `[Amodei2016]` Amodei, D., Olah, C., Steinhardt, J., Christiano, P., Schulman, J., and Mané, D. (2016). `Concrete Problems in AI Safety.`
  Relevance: good lens for specification gaming, unsafe optimization, and operator-overridden autonomy.
  Acquisition: local copy preferred.

- `[ClaessenHughes2000]` Claessen, K., and Hughes, J. (2000). `QuickCheck: A Lightweight Tool for Random Testing of Haskell Programs.` ICFP 2000.
  Relevance: supports stronger property-based validation of domain policies and lifecycle invariants.
  Acquisition: local copy preferred.

## Priority B: Valuable Near-Term Additions

- `[Madaan2023]` Madaan, A., Tandon, N., Clark, P., et al. (2023). `Self-Refine: Iterative Refinement with Self-Feedback.`
  Relevance: useful for bounded refinement and critique loops after D1.

- `[Beltagy2024]` add one recent repository-aware or long-context software engineering paper once the exact Hephaestus context strategy is chosen.
  Relevance: keep this slot for the repo-context direction you decide to standardize on.

- `[Ousterhout2018]` Ousterhout, J. (2018). `A Philosophy of Software Design.`
  Relevance: not a paper, but worth having locally because Hephaestus is explicitly fighting complexity concentration.

- `[Lamport2002]` Lamport, L. (2002). `Specifying Systems.`
  Relevance: not a paper, but valuable if D2-D5 add stronger invariants, replay rules, or promotion safety checks.

## Suggested Local Library Shape

Initial implementation status:

- `sources/notes/` now exists and contains notes for the active catalog
- `sources/papers/` now exists and contains the first lawful open-access batch
- `sources/acquisition-manifest.md` tracks what is stocked, note-only, or still pending lawful acquisition

Recommended on-drive structure:

```text
sources/
  sources.txt
  research-library.md
  papers/
    00-foundations/
    10-self-adaptation/
    20-event-evidence/
    30-human-oversight/
    40-llm-agents/
    50-safety-verification/
  notes/
    Bainbridge1983.md
    ChandyLamport1985.md
    Endsley1995.md
    LeeSee2004.md
    Yang2024SWEAgent.md
    Zhang2023RepoCoder.md
```

For each source note, capture:

1. full citation
2. local file path if present
3. public URL or DOI
4. 3-7 bullet summary
5. direct relevance to Hephaestus
6. which blueprint phase it informs (`D1` to `D6`)

## Minimal Acquisition Standard

For a paper to count as “present” in the Hephaestus library, it should have at least:

- citation
- stable URL or DOI
- one local note file

For a paper to count as “fully stocked,” it should have:

- citation
- stable URL or DOI
- local PDF or lawful local copy
- one local note file
- tags for blueprint phases

## Proposed First Acquisition Batch

If building the library in order, start with this batch:

1. `ChandyLamport1985`
2. `Endsley1995`
3. `LeeSee2004`
4. `Yang2024SWEAgent`
5. `Zhang2023RepoCoder`
6. `Schick2023Toolformer`
7. `Shinn2023Reflexion`
8. `Amodei2016`
9. `ClaessenHughes2000`

That set would materially strengthen Hephaestus for D2-D4 without bloating the library with marginal sources.

## Operating Rules

To keep the library useful instead of decorative:

1. Every new paper must map to at least one active blueprint phase or architectural risk.
2. Every stored paper should have a short local note written in project language, not generic summary language.
3. If a paper stops informing decisions, archive the note or demote it from the active set.
4. Prefer a small active library with high reread value over a large passive dump.
5. Treat the library as design infrastructure, not as a scrapbook.

## Active Reading Order

If the team wants a disciplined sequence rather than opportunistic collection, use this order:

1. D2 event and evidence work: `ChandyLamport1985`, `Helland2015`, `Verraes2019`
2. approval and operator workflow work: `Endsley1995`, `LeeSee2004`, `Woods1996`
3. agent-planning and tool-selection work: `Yang2024SWEAgent`, `Zhang2023RepoCoder`, `Schick2023Toolformer`, `Shinn2023Reflexion`
4. safety and verification work: `Amodei2016`, `ClaessenHughes2000`

## Library Success Criteria

The research library is doing its job when:

- design papers are cited in architecture notes and ADRs
- blueprint phases can point to a small set of grounding sources
- repeated design arguments get shorter because the library already settled them
- operator, safety, and audit decisions reference prior notes instead of being reinvented ad hoc
- the active library remains readable by one engineer in a few afternoons