import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

interface EfficiencySnapshot {
  timestamp: string;
  throughput?: { completedPerDay?: number };
  latencyMs?: { admissionToComplete?: { p95?: number } };
  quality?: { completionRate?: number; retryRate?: number };
  policy?: {
    allowlistDenialRate?: number;
    allowlistDenialCount?: number;
    allowlistDenialTaxonomyTop?: Array<{ bucket?: string; count?: number }>;
  };
  efficiencyIndex?: {
    score?: number;
    attribution?: {
      topCohorts?: Array<{
        cohort?: string;
        ticketCount?: number;
        completionRate?: number;
        retryRate?: number;
        scoreContribution?: number;
      }>;
    };
  };
  variance?: { alerts?: string[] };
}

const METRICS_DIR = path.join('docs', 'metrics');
const HISTORY_FILE = path.join(METRICS_DIR, 'efficiency-history.jsonl');
const REPORT_FILE = path.join(METRICS_DIR, 'efficiency-weekly-report.md');

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function format(value: number): string {
  return value.toFixed(3);
}

function parseSnapshots(content: string): EfficiencySnapshot[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as EfficiencySnapshot)
    .filter((entry) => !!entry.timestamp)
    .sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime());
}

function withinDays(entries: EfficiencySnapshot[], days: number): EfficiencySnapshot[] {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return entries.filter((entry) => new Date(entry.timestamp).getTime() >= cutoff);
}

function summarize(entries: EfficiencySnapshot[]): {
  samples: number;
  throughputAvg: number;
  p95Avg: number;
  completionAvg: number;
  retryAvg: number;
  allowlistDenialRateAvg: number;
  scoreAvg: number;
  alerts: string[];
} {
  const throughput = entries.map((entry) => Number(entry.throughput?.completedPerDay ?? 0));
  const p95 = entries.map((entry) => Number(entry.latencyMs?.admissionToComplete?.p95 ?? 0));
  const completion = entries.map((entry) => Number(entry.quality?.completionRate ?? 0));
  const retry = entries.map((entry) => Number(entry.quality?.retryRate ?? 0));
  const allowlistDenialRate = entries.map((entry) => Number(entry.policy?.allowlistDenialRate ?? 0));
  const score = entries.map((entry) => Number(entry.efficiencyIndex?.score ?? 0));

  const alerts = entries.flatMap((entry) => entry.variance?.alerts ?? []);

  return {
    samples: entries.length,
    throughputAvg: average(throughput),
    p95Avg: average(p95),
    completionAvg: average(completion),
    retryAvg: average(retry),
    allowlistDenialRateAvg: average(allowlistDenialRate),
    scoreAvg: average(score),
    alerts,
  };
}

function buildReport(allEntries: EfficiencySnapshot[]): string {
  const weekly = withinDays(allEntries, 7);
  const previous = allEntries.filter((entry) => {
    const ts = new Date(entry.timestamp).getTime();
    const now = Date.now();
    return ts < now - 7 * 24 * 60 * 60 * 1000 && ts >= now - 14 * 24 * 60 * 60 * 1000;
  });

  const currentSummary = summarize(weekly);
  const previousSummary = summarize(previous);

  const delta = {
    throughput: currentSummary.throughputAvg - previousSummary.throughputAvg,
    p95: currentSummary.p95Avg - previousSummary.p95Avg,
    completion: currentSummary.completionAvg - previousSummary.completionAvg,
    retry: currentSummary.retryAvg - previousSummary.retryAvg,
    allowlistDenialRate:
      currentSummary.allowlistDenialRateAvg - previousSummary.allowlistDenialRateAvg,
    score: currentSummary.scoreAvg - previousSummary.scoreAvg,
  };

  const uniqueAlerts = [...new Set(currentSummary.alerts)];
  const latest = allEntries[allEntries.length - 1];
  const denialTaxonomyTop = latest?.policy?.allowlistDenialTaxonomyTop ?? [];
  const topCohorts = latest?.efficiencyIndex?.attribution?.topCohorts ?? [];
  const recommendations: string[] = [];

  if (delta.allowlistDenialRate > 0) {
    recommendations.push('Prioritize allowlist policy cleanup because denial rate increased week-over-week.');
  }
  if (delta.retry > 0) {
    recommendations.push('Retry rate increased; review transient failure handling and warmup windows.');
  }
  if (delta.p95 > 0) {
    recommendations.push('Admission-to-complete latency worsened; tune pending-dispatch pacing and queue pressure thresholds.');
  }
  if (uniqueAlerts.length > 0) {
    recommendations.push('Variance alerts are present; schedule bounded mitigation tickets for the top two alert families.');
  }
  if (denialTaxonomyTop.length > 0) {
    recommendations.push(`Top denial bucket: ${(denialTaxonomyTop[0]?.bucket ?? 'unknown').trim()} - add or document approved command variants.`);
  }

  return [
    '# Hephaestus Weekly Efficiency Report',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    '## Current 7-Day Window',
    '',
    `- Samples: ${currentSummary.samples}`,
    `- Average efficiency score: ${format(currentSummary.scoreAvg)}`,
    `- Average throughput/day: ${format(currentSummary.throughputAvg)}`,
    `- Average p95 admission->complete (ms): ${format(currentSummary.p95Avg)}`,
    `- Average completion rate: ${format(currentSummary.completionAvg)}`,
    `- Average retry rate: ${format(currentSummary.retryAvg)}`,
    `- Average allowlist denial rate: ${format(currentSummary.allowlistDenialRateAvg)}`,
    '',
    '## Week-over-Week Delta',
    '',
    `- Efficiency score delta: ${format(delta.score)}`,
    `- Throughput/day delta: ${format(delta.throughput)}`,
    `- p95 admission->complete delta (ms): ${format(delta.p95)}`,
    `- Completion rate delta: ${format(delta.completion)}`,
    `- Retry rate delta: ${format(delta.retry)}`,
    `- Allowlist denial rate delta: ${format(delta.allowlistDenialRate)}`,
    '',
    '## Denial Taxonomy (Latest Snapshot)',
    '',
    ...(denialTaxonomyTop.length
      ? denialTaxonomyTop.map((entry) => `- ${(entry.bucket ?? 'unknown').trim()}: ${Number(entry.count ?? 0)}`)
      : ['- none observed']),
    '',
    '## Cohort Attribution (Latest Snapshot)',
    '',
    ...(topCohorts.length
      ? topCohorts.map(
          (entry) =>
            `- ${entry.cohort ?? 'UNKNOWN'}: tickets=${Number(entry.ticketCount ?? 0)}, completion=${format(Number(entry.completionRate ?? 0))}, retry=${format(Number(entry.retryRate ?? 0))}, contribution=${format(Number(entry.scoreContribution ?? 0))}`
        )
      : ['- unavailable']),
    '',
    '## Recommended Actions',
    '',
    ...(recommendations.length ? recommendations.map((entry) => `- ${entry}`) : ['- Continue current policy; no adverse efficiency deltas detected this week.']),
    '',
    '## Variance Alerts (Current Window)',
    '',
    ...(uniqueAlerts.length ? uniqueAlerts.map((alert) => `- ${alert}`) : ['- none observed']),
    '',
  ].join('\n');
}

export async function generateWeeklyEfficiencyReport(): Promise<string> {
  const history = await fs.readFile(HISTORY_FILE, 'utf-8');
  const entries = parseSnapshots(history);
  if (entries.length === 0) {
    throw new Error('No efficiency history entries found. Run npm run metrics:efficiency first.');
  }

  const report = buildReport(entries);
  await fs.mkdir(METRICS_DIR, { recursive: true });
  await fs.writeFile(REPORT_FILE, `${report}\n`, 'utf-8');
  return REPORT_FILE;
}

async function main(): Promise<void> {
  const reportPath = await generateWeeklyEfficiencyReport();
  console.log(`Weekly efficiency report written to ${reportPath}`);
}

function isDirectExecution(): boolean {
  if (!process.argv[1]) {
    return false;
  }

  return path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isDirectExecution()) {
  main().catch((error) => {
    console.error('Failed to build weekly efficiency report:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
