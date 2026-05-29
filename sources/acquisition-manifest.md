# Hephaestus Research Acquisition Manifest

This file is the working inventory for the implemented research library. It records what is locally present now, what remains note-only, and what still needs a lawful acquisition path.

## Current State

| Key | Phase | Note | Local Copy | Public URL or DOI | Current Status | Next Action |
| --- | --- | --- | --- | --- | --- | --- |
| ChandyLamport1985 | D2 | sources/notes/ChandyLamport1985.md | sources/papers/20-event-evidence/ChandyLamport1985.pdf | https://lamport.azurewebsites.net/pubs/chandy.pdf | copy+note | stocked from a verified public PDF |
| Helland2015 | D2 | sources/notes/Helland2015.md | not present | https://doi.org/10.1145/2857274.2884038 | note | acquire via licensed or open path |
| Verraes2019 | D2 | sources/notes/Verraes2019.md | not present | pending verification | note | verify the stable public landing page |
| Endsley1995 | D6 | sources/notes/Endsley1995.md | not present | https://doi.org/10.1518/001872095779049543 | note | acquire via licensed or open path |
| LeeSee2004 | D3-D6 | sources/notes/LeeSee2004.md | not present | https://doi.org/10.1518/hfes.46.1.50.30392 | note | acquire via licensed or open path |
| Woods1996 | D3-D6 | sources/notes/Woods1996.md | not present | pending verification | note | verify a stable landing page or bibliography source |
| Yang2024SWEAgent | D3-D4 | sources/notes/Yang2024SWEAgent.md | sources/papers/40-llm-agents/Yang2024SWEAgent.pdf | http://arxiv.org/abs/2405.15793v3 | copy+note | keep note updated against implementation decisions |
| Zhang2023RepoCoder | D3 | sources/notes/Zhang2023RepoCoder.md | sources/papers/40-llm-agents/Zhang2023RepoCoder.pdf | http://arxiv.org/abs/2303.12570v3 | copy+note | connect retrieval guidance to context policy |
| Schick2023Toolformer | D3 | sources/notes/Schick2023Toolformer.md | sources/papers/40-llm-agents/Schick2023Toolformer.pdf | http://arxiv.org/abs/2302.04761v1 | copy+note | connect tool-use lessons to command catalog policy |
| Shinn2023Reflexion | D3-D4 | sources/notes/Shinn2023Reflexion.md | sources/papers/40-llm-agents/Shinn2023Reflexion.pdf | http://arxiv.org/abs/2303.11366v4 | copy+note | bound reflection and retry loops explicitly |
| Amodei2016 | D3-D5 | sources/notes/Amodei2016.md | sources/papers/50-safety-verification/Amodei2016.pdf | http://arxiv.org/abs/1606.06565v2 | copy+note | map concrete failure modes into D3-D5 safeguards |
| ClaessenHughes2000 | D1-D5 | sources/notes/ClaessenHughes2000.md | sources/papers/50-safety-verification/ClaessenHughes2000.pdf | https://www.cs.tufts.edu/~nr/cs257/archive/john-hughes/quick.pdf | copy+note | stocked from a verified public PDF |
| Madaan2023SelfRefine | D3-D4 | sources/notes/Madaan2023SelfRefine.md | sources/papers/40-llm-agents/Madaan2023SelfRefine.pdf | https://arxiv.org/abs/2303.17651 | copy+note | added as a bounded self-refinement reference |
| Jimenez2024SWEBench | D3-D4 | sources/notes/Jimenez2024SWEBench.md | sources/papers/40-llm-agents/Jimenez2024SWEBench.pdf | https://arxiv.org/abs/2310.06770 | copy+note | added as a realistic issue-resolution benchmark |
| Xia2024Agentless | D3-D4 | sources/notes/Xia2024Agentless.md | sources/papers/40-llm-agents/Xia2024Agentless.pdf | https://arxiv.org/abs/2407.01489 | copy+note | added as a simple workflow counterpoint to heavy agent designs |
| Zhang2024AutoCodeRover | D3-D4 | sources/notes/Zhang2024AutoCodeRover.md | sources/papers/40-llm-agents/Zhang2024AutoCodeRover.pdf | https://arxiv.org/abs/2404.05427 | copy+note | added as a structured retrieval and localization reference |
| FooteYoder1997BigBallOfMud | D1-D4 | sources/notes/FooteYoder1997BigBallOfMud.md | sources/papers/00-foundations/FooteYoder1997BigBallOfMud.pdf | https://www.laputan.org/pub/foote/mud.pdf | copy+note | added as a complexity-drift architectural grounding source |
| Helland2007LifeBeyondDistributedTransactions | D2-D5 | sources/notes/Helland2007LifeBeyondDistributedTransactions.md | sources/papers/20-event-evidence/Helland2007LifeBeyondDistributedTransactions.pdf | https://www.cidrdb.org/cidr2007/papers/cidr07p15.pdf | copy+note | added as distributed workflow and compensation grounding |
| Yao2023ReAct | D3-D4 | sources/notes/Yao2023ReAct.md | sources/papers/40-llm-agents/Yao2023ReAct.pdf | https://arxiv.org/abs/2210.03629 | copy+note | added as reasoning-action loop grounding |
| LevesonThomas2018STPAHandbook | D3-D6 | sources/notes/LevesonThomas2018STPAHandbook.md | sources/papers/50-safety-verification/LevesonThomas2018STPAHandbook.pdf | https://psas.scripts.mit.edu/home/get_file.php?name=STPA_handbook.pdf | copy+note | added as control-theoretic safety analysis grounding |
| Tao2024MAGIS | D3-D4 | sources/notes/Tao2024MAGIS.md | sources/papers/40-llm-agents/Tao2024MAGIS.pdf | https://arxiv.org/abs/2403.17927 | copy+note | added as a multi-agent GitHub issue-resolution architecture reference |
| Bairi2023CodePlan | D3-D4 | sources/notes/Bairi2023CodePlan.md | sources/papers/40-llm-agents/Bairi2023CodePlan.pdf | https://arxiv.org/abs/2309.12499 | copy+note | added as repository-level planning and edit-sequencing grounding |
| Liu2024STALLPlus | D3-D4 | sources/notes/Liu2024STALLPlus.md | sources/papers/40-llm-agents/Liu2024STALLPlus.pdf | https://arxiv.org/abs/2406.10018 | copy+note | added as static-analysis integration grounding for repo workflows |
| Ding2026SWEReplay | D3-D4 | sources/notes/Ding2026SWEReplay.md | sources/papers/40-llm-agents/Ding2026SWEReplay.pdf | https://arxiv.org/abs/2601.22129 | copy+note | added as test-time scaling and trajectory-reuse grounding |

## Library Rule In Force

- Store local PDFs only when they are open access or lawfully licensed.
- Keep a local note for every active source even when the PDF is absent.
- Treat pending URL verification as an acquisition gap, not as a completed entry.
