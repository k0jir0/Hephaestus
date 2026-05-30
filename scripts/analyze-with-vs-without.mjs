#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';

function parseArgs(argv) {
  const options = {
    input: 'docs/metrics/with-vs-without-runs.csv',
    outputJson: 'docs/metrics/with-vs-without-results.json',
    outputMd: 'docs/metrics/with-vs-without-results.md',
    bootstrapSamples: 10000,
    seed: 1337,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      continue;
    }

    const key = arg.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      continue;
    }

    if (key === 'input') {
      options.input = value;
      i += 1;
    } else if (key === 'output-json') {
      options.outputJson = value;
      i += 1;
    } else if (key === 'output-md') {
      options.outputMd = value;
      i += 1;
    } else if (key === 'bootstrap-samples') {
      options.bootstrapSamples = Number(value) || options.bootstrapSamples;
      i += 1;
    } else if (key === 'seed') {
      options.seed = Number(value) || options.seed;
      i += 1;
    }
  }

  return options;
}

function parseCsv(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));

  if (lines.length === 0) {
    return [];
  }

  const header = splitCsvLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const values = splitCsvLine(lines[i]);
    const row = {};
    for (let j = 0; j < header.length; j += 1) {
      row[header[j]] = values[j] ?? '';
    }
    rows.push(row);
  }
  return rows;
}

function splitCsvLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      values.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  values.push(current);
  return values;
}

function toBool(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : NaN;
}

function median(values) {
  if (!values.length) {
    return NaN;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function percentile(values, p) {
  if (!values.length) {
    return NaN;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) {
    return sorted[lower];
  }
  const weight = index - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function createRng(seed) {
  let state = seed >>> 0;
  return function rand() {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function buildPairs(rows) {
  const buckets = new Map();
  for (const row of rows) {
    const participantId = String(row.participant_id || '').trim();
    const taskId = String(row.task_id || '').trim();
    const condition = String(row.condition || '').trim().toLowerCase();

    if (!participantId || !taskId) {
      continue;
    }
    if (condition !== 'with_hephaestus' && condition !== 'without_hephaestus') {
      continue;
    }

    const durationMinutes = toNumber(row.duration_minutes);
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
      continue;
    }

    const completed = String(row.completion_status || '').trim().toLowerCase() === 'completed';
    const verificationPassed = toBool(row.verification_passed);
    const reviewerPass = toBool(row.reviewer_pass);

    const key = `${participantId}::${taskId}`;
    if (!buckets.has(key)) {
      buckets.set(key, {});
    }

    buckets.get(key)[condition] = {
      participantId,
      taskId,
      condition,
      durationMinutes,
      qualityPass: completed && verificationPassed && reviewerPass,
    };
  }

  const pairs = [];
  for (const bucket of buckets.values()) {
    if (!bucket.with_hephaestus || !bucket.without_hephaestus) {
      continue;
    }

    pairs.push({
      participantId: bucket.with_hephaestus.participantId,
      taskId: bucket.with_hephaestus.taskId,
      withHephaestus: bucket.with_hephaestus,
      withoutHephaestus: bucket.without_hephaestus,
    });
  }

  return pairs;
}

function analyzeQuality(rows) {
  const byCondition = {
    with_hephaestus: { total: 0, qualityPass: 0 },
    without_hephaestus: { total: 0, qualityPass: 0 },
  };

  for (const row of rows) {
    const condition = String(row.condition || '').trim().toLowerCase();
    if (condition !== 'with_hephaestus' && condition !== 'without_hephaestus') {
      continue;
    }

    byCondition[condition].total += 1;
    const completed = String(row.completion_status || '').trim().toLowerCase() === 'completed';
    const verificationPassed = toBool(row.verification_passed);
    const reviewerPass = toBool(row.reviewer_pass);
    if (completed && verificationPassed && reviewerPass) {
      byCondition[condition].qualityPass += 1;
    }
  }

  const withRate = byCondition.with_hephaestus.total > 0
    ? byCondition.with_hephaestus.qualityPass / byCondition.with_hephaestus.total
    : NaN;
  const withoutRate = byCondition.without_hephaestus.total > 0
    ? byCondition.without_hephaestus.qualityPass / byCondition.without_hephaestus.total
    : NaN;

  return {
    withHephaestus: {
      total: byCondition.with_hephaestus.total,
      qualityPass: byCondition.with_hephaestus.qualityPass,
      rate: withRate,
    },
    withoutHephaestus: {
      total: byCondition.without_hephaestus.total,
      qualityPass: byCondition.without_hephaestus.qualityPass,
      rate: withoutRate,
    },
    nonInferiorityDelta: Number.isFinite(withRate) && Number.isFinite(withoutRate)
      ? withRate - withoutRate
      : NaN,
  };
}

function computeSpeedupPercent(withDurations, withoutDurations) {
  const medianWith = median(withDurations);
  const medianWithout = median(withoutDurations);
  if (!Number.isFinite(medianWith) || !Number.isFinite(medianWithout) || medianWithout <= 0) {
    return { medianWith, medianWithout, speedupPercent: NaN };
  }

  const speedupPercent = ((medianWithout - medianWith) / medianWithout) * 100;
  return { medianWith, medianWithout, speedupPercent };
}

function bootstrapSpeedup(pairs, samples, seed) {
  if (!pairs.length) {
    return { lower: NaN, upper: NaN };
  }

  const rand = createRng(seed);
  const estimates = [];

  for (let i = 0; i < samples; i += 1) {
    const sampled = [];
    for (let j = 0; j < pairs.length; j += 1) {
      const index = Math.floor(rand() * pairs.length);
      sampled.push(pairs[index]);
    }

    const withDurations = sampled.map((pair) => pair.withHephaestus.durationMinutes);
    const withoutDurations = sampled.map((pair) => pair.withoutHephaestus.durationMinutes);
    const { speedupPercent } = computeSpeedupPercent(withDurations, withoutDurations);
    if (Number.isFinite(speedupPercent)) {
      estimates.push(speedupPercent);
    }
  }

  return {
    lower: percentile(estimates, 0.025),
    upper: percentile(estimates, 0.975),
  };
}

function normalCdf(x) {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

function erf(x) {
  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const t = 1 / (1 + p * absX);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);
  return sign * y;
}

function wilcoxonSignedRank(differences) {
  const nonZero = differences.filter((value) => value !== 0);
  const n = nonZero.length;

  if (n === 0) {
    return { n: 0, wPlus: 0, pValueTwoSided: NaN, effectSizeRankBiserial: NaN };
  }

  const rows = nonZero.map((value) => ({ sign: Math.sign(value), abs: Math.abs(value) }));
  rows.sort((a, b) => a.abs - b.abs);

  let rank = 1;
  for (let i = 0; i < rows.length; ) {
    let j = i + 1;
    while (j < rows.length && rows[j].abs === rows[i].abs) {
      j += 1;
    }

    const avgRank = (rank + (rank + (j - i) - 1)) / 2;
    for (let k = i; k < j; k += 1) {
      rows[k].rank = avgRank;
    }

    rank += (j - i);
    i = j;
  }

  let wPlus = 0;
  let wMinus = 0;
  for (const row of rows) {
    if (row.sign > 0) {
      wPlus += row.rank;
    } else {
      wMinus += row.rank;
    }
  }

  const mean = (n * (n + 1)) / 4;
  let tieCorrection = 0;
  for (let i = 0; i < rows.length; ) {
    let j = i + 1;
    while (j < rows.length && rows[j].abs === rows[i].abs) {
      j += 1;
    }
    const t = j - i;
    if (t > 1) {
      tieCorrection += t * (t * t - 1);
    }
    i = j;
  }

  const variance = (n * (n + 1) * (2 * n + 1) - tieCorrection / 2) / 24;
  const continuity = wPlus > mean ? 0.5 : -0.5;
  const z = variance > 0 ? (wPlus - mean - continuity) / Math.sqrt(variance) : 0;
  const pValueTwoSided = 2 * Math.min(normalCdf(z), 1 - normalCdf(z));

  const totalRank = (n * (n + 1)) / 2;
  const effectSizeRankBiserial = totalRank > 0 ? (wPlus - wMinus) / totalRank : NaN;

  return {
    n,
    wPlus,
    wMinus,
    z,
    pValueTwoSided,
    effectSizeRankBiserial,
  };
}

function toFixedOrNa(value, digits = 3) {
  return Number.isFinite(value) ? value.toFixed(digits) : 'n/a';
}

function buildMarkdown(result) {
  const lines = [];
  lines.push('# With-vs-Without Hephaestus Results');
  lines.push('');
  lines.push(`Generated at: ${result.generatedAt}`);
  lines.push(`Input file: ${result.inputFile}`);
  lines.push('');
  lines.push('## Data Summary');
  lines.push(`- Rows parsed: ${result.rowsParsed}`);
  lines.push(`- Paired runs: ${result.pairedRuns}`);
  lines.push('');
  lines.push('## Speed Outcome');
  lines.push(`- Median time with Hephaestus (minutes): ${toFixedOrNa(result.speed.medianWith, 2)}`);
  lines.push(`- Median time without Hephaestus (minutes): ${toFixedOrNa(result.speed.medianWithout, 2)}`);
  lines.push(`- Estimated speedup (%): ${toFixedOrNa(result.speed.speedupPercent, 2)}`);
  lines.push(`- 95% bootstrap CI (%): [${toFixedOrNa(result.speed.ci95.lower, 2)}, ${toFixedOrNa(result.speed.ci95.upper, 2)}]`);
  lines.push('');
  lines.push('## Statistical Test');
  lines.push(`- Wilcoxon n: ${result.wilcoxon.n}`);
  lines.push(`- Wilcoxon p-value (two-sided): ${toFixedOrNa(result.wilcoxon.pValueTwoSided, 4)}`);
  lines.push(`- Rank-biserial effect size: ${toFixedOrNa(result.wilcoxon.effectSizeRankBiserial, 4)}`);
  lines.push('');
  lines.push('## Quality Comparison');
  lines.push(`- With Hephaestus quality pass rate: ${toFixedOrNa(result.quality.withHephaestus.rate * 100, 2)}% (${result.quality.withHephaestus.qualityPass}/${result.quality.withHephaestus.total})`);
  lines.push(`- Without Hephaestus quality pass rate: ${toFixedOrNa(result.quality.withoutHephaestus.rate * 100, 2)}% (${result.quality.withoutHephaestus.qualityPass}/${result.quality.withoutHephaestus.total})`);
  lines.push(`- Non-inferiority delta (with - without): ${toFixedOrNa(result.quality.nonInferiorityDelta * 100, 2)}%`);
  lines.push('');
  lines.push('## Claim Guidance');

  const ciLower = result.speed.ci95.lower;
  const speedup = result.speed.speedupPercent;
  const qualityDelta = result.quality.nonInferiorityDelta;
  const minimumPairedRunsForClaim = 24;
  const canClaim = Number.isFinite(speedup)
    && Number.isFinite(ciLower)
    && Number.isFinite(qualityDelta)
    && result.pairedRuns >= minimumPairedRunsForClaim
    && speedup > 0
    && ciLower > 0
    && qualityDelta >= 0;

  if (canClaim) {
    lines.push('- Claim condition met: measured improvement is positive, CI lower bound is above zero, and quality is non-inferior.');
  } else {
    lines.push(`- Claim condition not met yet: require at least ${minimumPairedRunsForClaim} paired runs and positive CI/quality checks before making a causal speedup claim.`);
  }

  lines.push('');
  lines.push('## Reproducibility');
  lines.push('- Script: scripts/analyze-with-vs-without.mjs');
  lines.push(`- Bootstrap samples: ${result.bootstrapSamples}`);
  lines.push(`- Seed: ${result.seed}`);

  return `${lines.join('\n')}\n`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const repoRoot = process.cwd();

  const inputPath = path.resolve(repoRoot, options.input);
  const outputJsonPath = path.resolve(repoRoot, options.outputJson);
  const outputMdPath = path.resolve(repoRoot, options.outputMd);

  const csvRaw = await fs.readFile(inputPath, 'utf8');
  const rows = parseCsv(csvRaw);

  const pairs = buildPairs(rows);
  const withDurations = pairs.map((pair) => pair.withHephaestus.durationMinutes);
  const withoutDurations = pairs.map((pair) => pair.withoutHephaestus.durationMinutes);

  const speed = computeSpeedupPercent(withDurations, withoutDurations);
  const ci95 = bootstrapSpeedup(pairs, options.bootstrapSamples, options.seed);

  const differences = pairs.map((pair) => pair.withoutHephaestus.durationMinutes - pair.withHephaestus.durationMinutes);
  const wilcoxon = wilcoxonSignedRank(differences);
  const quality = analyzeQuality(rows);

  const result = {
    generatedAt: new Date().toISOString(),
    inputFile: options.input,
    outputFiles: {
      json: options.outputJson,
      markdown: options.outputMd,
    },
    rowsParsed: rows.length,
    pairedRuns: pairs.length,
    bootstrapSamples: options.bootstrapSamples,
    seed: options.seed,
    speed: {
      ...speed,
      ci95,
    },
    wilcoxon,
    quality,
  };

  await fs.mkdir(path.dirname(outputJsonPath), { recursive: true });
  await fs.mkdir(path.dirname(outputMdPath), { recursive: true });
  await fs.writeFile(outputJsonPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  await fs.writeFile(outputMdPath, buildMarkdown(result), 'utf8');

  console.log(`Wrote ${options.outputJson}`);
  console.log(`Wrote ${options.outputMd}`);
  console.log(`Paired runs analyzed: ${pairs.length}`);
  console.log(`Estimated speedup (%): ${toFixedOrNa(result.speed.speedupPercent, 2)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
