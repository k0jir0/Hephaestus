# With-vs-Without Hephaestus Results

Generated at: 2026-05-30T14:37:09.028Z
Input file: docs/metrics/with-vs-without-runs.csv

## Data Summary
- Rows parsed: 4
- Paired runs: 2

## Speed Outcome
- Median time with Hephaestus (minutes): 29.50
- Median time without Hephaestus (minutes): 38.50
- Estimated speedup (%): 23.38
- 95% bootstrap CI (%): [12.90, 30.43]

## Statistical Test
- Wilcoxon n: 2
- Wilcoxon p-value (two-sided): 0.3711
- Rank-biserial effect size: 1.0000

## Quality Comparison
- With Hephaestus quality pass rate: 100.00% (2/2)
- Without Hephaestus quality pass rate: 100.00% (2/2)
- Non-inferiority delta (with - without): 0.00%

## Claim Guidance
- Claim condition not met yet: require at least 24 paired runs and positive CI/quality checks before making a causal speedup claim.

## Reproducibility
- Script: scripts/analyze-with-vs-without.mjs
- Bootstrap samples: 10000
- Seed: 1337
