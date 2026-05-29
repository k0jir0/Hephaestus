# Research Validity Audit

Audit date: 2026-05-29

Scope:

- `sources/library-catalog.md`
- `sources/acquisition-manifest.md`
- `sources/notes/`
- `sources/sources.txt`

Purpose: screen the local research library for citations that appear fake,
hallucinated, impossible, or bibliographically ungrounded.

This audit checks bibliographic existence and source integrity. It does not
certify that every claim in every paper is scientifically correct, only that the
paper, chapter, handbook, or preprint appears to be a real source and is not
obviously fabricated.

## Summary

- Active catalog entries checked: 24
- Verified real sources: 23
- Quarantined entries: 1
- High-risk hallucination found: `Verraes2019`

## Quarantined Entry

| Key | Current Citation | Finding | Action |
| --- | --- | --- | --- |
| `Verraes2019` | Verraes, G., and Vernon, V. (2019). Event Sourcing. Queue, 17(1). | I could not verify this citation in ACM Queue, DOI indexes, or general scholarly search. ACM Queue volume 17 issue 1 exists, but the relevant event-log article found there is `Online Event Processing` by Martin Kleppmann, Alastair R. Beresford, and Boerge Svingen, not a Verraes/Vernon article titled `Event Sourcing`. | Keep quarantined. Do not cite for D2 design work until replaced by a verified source such as Fowler's `Event Sourcing` article, Kleppmann et al.'s `Online Event Processing`, or another real event-sourcing source. |

## Active Catalog Results

| Key | Status | Evidence |
| --- | --- | --- |
| `ChandyLamport1985` | verified | DOI and Lamport public PDF verify `Distributed Snapshots: Determining Global States of Distributed Systems`. |
| `Helland2015` | verified | ACM Queue verifies `Immutability Changes Everything` by Pat Helland. |
| `Verraes2019` | quarantine | No verified landing page found for the cited ACM Queue paper. |
| `Endsley1995` | verified | Sage verifies `Toward a Theory of Situation Awareness in Dynamic Systems`, Human Factors 37(1), 32-64. |
| `LeeSee2004` | verified | Sage verifies `Trust in Automation: Designing for Appropriate Reliance`, Human Factors 46(1), 50-80. |
| `Woods1996` | verified chapter | Taylor & Francis verifies the book and table-of-contents entry `Decomposing Automation: Apparent Simplicity, Real Complexity` by David D. Woods. |
| `Yang2024SWEAgent` | verified preprint | arXiv verifies `SWE-agent: Agent-Computer Interfaces Enable Automated Software Engineering`. |
| `Jimenez2024SWEBench` | verified preprint / conference paper | arXiv verifies `SWE-bench: Can Language Models Resolve Real-World GitHub Issues?`. |
| `Zhang2023RepoCoder` | verified preprint / conference paper | arXiv verifies `RepoCoder: Repository-Level Code Completion Through Iterative Retrieval and Generation`. |
| `Zhang2024AutoCodeRover` | verified preprint / conference paper | arXiv verifies `AutoCodeRover: Autonomous Program Improvement`. |
| `Schick2023Toolformer` | verified preprint | arXiv verifies `Toolformer: Language Models Can Teach Themselves to Use Tools`. |
| `Shinn2023Reflexion` | verified preprint | arXiv verifies `Reflexion: Language Agents with Verbal Reinforcement Learning`. |
| `Madaan2023SelfRefine` | verified preprint | arXiv verifies `Self-Refine: Iterative Refinement with Self-Feedback`. |
| `Xia2024Agentless` | verified preprint | arXiv verifies `Agentless: Demystifying LLM-based Software Engineering Agents`. |
| `Yao2023ReAct` | verified preprint / conference paper | arXiv verifies `ReAct: Synergizing Reasoning and Acting in Language Models`. |
| `Tao2024MAGIS` | verified preprint | arXiv verifies `MAGIS: LLM-Based Multi-Agent Framework for GitHub Issue Resolution`. |
| `Bairi2023CodePlan` | verified preprint | arXiv verifies `CodePlan: Repository-level Coding using LLMs and Planning`. |
| `Liu2024STALLPlus` | verified preprint | arXiv verifies `STALL+: Boosting LLM-based Repository-level Code Completion with Static Analysis`. |
| `Ding2026SWEReplay` | verified preprint | arXiv verifies `SWE-Replay: Efficient Test-Time Scaling for Software Engineering Agents`, submitted 2026-01-29 and revised 2026-02-05. |
| `Helland2007LifeBeyondDistributedTransactions` | verified proceedings paper | CIDR public proceedings PDF verifies `Life beyond Distributed Transactions: An Apostate's Opinion`. |
| `Amodei2016` | verified preprint | arXiv verifies `Concrete Problems in AI Safety`. |
| `ClaessenHughes2000` | verified conference paper | DOI/DBLP and public PDF verify `QuickCheck: A Lightweight Tool for Random Testing of Haskell Programs`. |
| `LevesonThomas2018STPAHandbook` | verified handbook | MIT PSAS public PDF verifies the `STPA Handbook`. |
| `FooteYoder1997BigBallOfMud` | verified pattern paper | Public author-hosted PDF verifies `Big Ball of Mud`. |

## Canonical Bibliography Check

The wider `sources/sources.txt` bibliography was spot-checked against DOI,
publisher, author, arXiv, or public institutional pages. No additional fake or
hallucinated entries surfaced in this pass. Several entries are books, handbooks,
white papers, pattern papers, or preprints rather than peer-reviewed journal
articles; that is a classification issue, not a hallucination issue.

Notable classification reminders:

- `ShawGarlan1996` and `Ousterhout2018` are books, not research papers.
- `LevesonThomas2018STPAHandbook` is a handbook.
- Many LLM-agent entries are arXiv preprints; use them as current technical
  evidence, not as settled archival consensus.
- `FooteYoder1997BigBallOfMud` is a real and useful pattern paper, but not a
  conventional empirical CS paper.

## Evidence URLs

- Chandy and Lamport 1985: https://doi.org/10.1145/214451.214456 and https://lamport.azurewebsites.net/pubs/chandy.pdf
- Helland 2015: https://queue.acm.org/detail.cfm?id=2884038
- ACM Queue 17(1) counter-evidence for `Verraes2019`: https://queue.acm.org/detail.cfm?id=3321612
- Endsley 1995: https://doi.org/10.1518/001872095779049543
- Lee and See 2004: https://doi.org/10.1518/hfes.46.1.50_30392
- Woods 1996 chapter: https://www.taylorfrancis.com/chapters/mono/10.1201/9781315137957-1/decomposing-automation-apparent-simplicity-real-complexity-david-woods
- SWE-agent: https://arxiv.org/abs/2405.15793
- SWE-bench: https://arxiv.org/abs/2310.06770
- RepoCoder: https://arxiv.org/abs/2303.12570
- AutoCodeRover: https://arxiv.org/abs/2404.05427
- Toolformer: https://arxiv.org/abs/2302.04761
- Reflexion: https://arxiv.org/abs/2303.11366
- Self-Refine: https://arxiv.org/abs/2303.17651
- Agentless: https://arxiv.org/abs/2407.01489
- ReAct: https://arxiv.org/abs/2210.03629
- MAGIS: https://arxiv.org/abs/2403.17927
- CodePlan: https://arxiv.org/abs/2309.12499
- STALL+: https://arxiv.org/abs/2406.10018
- SWE-Replay: https://arxiv.org/abs/2601.22129
- Helland 2007: https://www.cidrdb.org/cidr2007/papers/cidr07p15.pdf
- Concrete Problems in AI Safety: https://arxiv.org/abs/1606.06565
- QuickCheck: https://doi.org/10.1145/351240.351266 and https://www.cs.tufts.edu/~nr/cs257/archive/john-hughes/quick.pdf
- STPA Handbook: https://psas.scripts.mit.edu/home/get_file.php?name=STPA_handbook.pdf
- Big Ball of Mud: https://www.laputan.org/pub/foote/mud.pdf

## Policy Change

Design work must not cite quarantined entries. A source can leave quarantine only
after it has one stable DOI, publisher page, arXiv page, public proceedings page,
or author/institution page that confirms the title, author list, and venue.
