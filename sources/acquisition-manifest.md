# Hephaestus Research Acquisition Manifest

This file is the working inventory for the implemented research library. It records what is locally present now, what remains note-only, and what still needs a lawful acquisition path.

## Current State

| Key | Phase | Note | Local Copy | Public URL or DOI | Current Status | Next Action |
| --- | --- | --- | --- | --- | --- | --- |
| ChandyLamport1985 | D2 | sources/notes/ChandyLamport1985.md | sources/papers/20-event-evidence/ChandyLamport1985.pdf | https://lamport.azurewebsites.net/pubs/chandy.pdf | copy+note | stocked from a verified public PDF |
| Helland2015 | D2 | sources/notes/Helland2015.md | not present | https://doi.org/10.1145/2857274.2884038 | note | acquire via licensed or open path |
| Endsley1995 | D6 | sources/notes/Endsley1995.md | not present | https://doi.org/10.1518/001872095779049543 | note | acquire via licensed or open path |
| LeeSee2004 | D3-D6 | sources/notes/LeeSee2004.md | not present | https://doi.org/10.1518/hfes.46.1.50.30392 | note | acquire via licensed or open path |
| Woods1996 | D3-D6 | sources/notes/Woods1996.md | not present | https://www.taylorfrancis.com/chapters/mono/10.1201/9781315137957-1/decomposing-automation-apparent-simplicity-real-complexity-david-woods | note | stable publisher landing page verified |
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
| NewResearch01_2408-08592 | P1-P5-P8 | sources/notes/NewResearch01_2408-08592.md | sources/papers/60-new-research/NewResearch01_2408-08592.pdf | https://arxiv.org/abs/2408.08592 | copy+note | runtime verification intake for monitor and invariant hardening |
| NewResearch02_2209-03013 | P2-P3-P8 | sources/notes/NewResearch02_2209-03013.md | sources/papers/60-new-research/NewResearch02_2209-03013.pdf | https://arxiv.org/abs/2209.03013 | copy+note | causal analysis intake for incident attribution quality |
| NewResearch03_2503-16227 | P3-P7 | sources/notes/NewResearch03_2503-16227.md | sources/papers/60-new-research/NewResearch03_2503-16227.pdf | https://arxiv.org/abs/2503.16227 | copy+note | trust dynamics intake for intervention timing policy |
| NewResearch04_2604-09452 | P3-P8 | sources/notes/NewResearch04_2604-09452.md | sources/papers/60-new-research/NewResearch04_2604-09452.pdf | https://arxiv.org/abs/2604.09452 | copy+note | safe policy optimization intake for constrained autonomy |
| NewResearch05_2404-14498 | P4-P6 | sources/notes/NewResearch05_2404-14498.md | sources/papers/60-new-research/NewResearch05_2404-14498.pdf | https://arxiv.org/abs/2404.14498 | copy+note | temporary saga-target placeholder; pending replacement with stronger workflow paper |
| NewResearch06_2406-04710 | P5 | sources/notes/NewResearch06_2406-04710.md | sources/papers/60-new-research/NewResearch06_2406-04710.pdf | https://arxiv.org/abs/2406.04710 | copy+note | long-horizon software benchmarking intake |
| NewResearch07_2202-12139 | P1-P2-P4 | sources/notes/NewResearch07_2202-12139.md | sources/papers/60-new-research/NewResearch07_2202-12139.pdf | https://arxiv.org/abs/2202.12139 | copy+note | testing-method intake for stateful workflow verification |
| NewResearch08_2306-00133 | P6-P8 | sources/notes/NewResearch08_2306-00133.md | sources/papers/60-new-research/NewResearch08_2306-00133.pdf | https://arxiv.org/abs/2306.00133 | copy+note | canary exposure intake for progressive rollout governance |
| NewResearch09_2512-11833 | P3-P7 | sources/notes/NewResearch09_2512-11833.md | sources/papers/60-new-research/NewResearch09_2512-11833.pdf | https://arxiv.org/abs/2512.11833 | copy+note | explainability intake for decision-centric operator support |
| NewResearch10_2410-05787 | P2-P3-P8 | sources/notes/NewResearch10_2410-05787.md | sources/papers/60-new-research/NewResearch10_2410-05787.pdf | https://arxiv.org/abs/2410.05787 | copy+note | multi-objective optimization intake for safety-throughput tuning |
| NewResearch11_2507-00421 | P8 | sources/notes/NewResearch11_2507-00421.md | sources/papers/60-new-research/NewResearch11_2507-00421.pdf | https://arxiv.org/abs/2507.00421 | copy+note | socio-technical devops intake for incident response framing |
| NewResearch12_2411-16100 | P8 | sources/notes/NewResearch12_2411-16100.md | sources/papers/60-new-research/NewResearch12_2411-16100.pdf | https://arxiv.org/abs/2411.16100 | copy+note | economics and automation intake for policy profile tradeoffs |

## Library Rule In Force

- Store local PDFs only when they are open access or lawfully licensed.
- Keep a local note for every active source even when the PDF is absent.
- Treat pending URL verification as an acquisition gap, not as a completed entry.
