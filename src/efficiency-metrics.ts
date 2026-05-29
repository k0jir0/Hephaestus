import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { generateWeeklyEfficiencyReport } from './efficiency-weekly-report.js';
import { TicketStoreRepository } from './task-store.js';
import type { TaskStatus, TaskTicket } from './types.js';

interface EfficiencySnapshot {
  timestamp: string;
  totals: {
    tickets: number;
    attempts: number;
    completed: number;
    blocked: number;
    awaitingApproval: number;
    pending: number;
    inProgress: number;
    cancelled: number;
  };
  throughput: {
    completedLast24h: number;
    completedPerDay: number;
  };
  latencyMs: {
    admissionToStart: PercentileSummary;
    startToComplete: PercentileSummary;
    admissionToComplete: PercentileSummary;
  };
  quality: {
    retryRate: number;
    blockRate: number;
    approvalRate: number;
    completionRate: number;
  };
  policy: {
    allowlistDenialCount: number;
    allowlistDenialRate: number;
  };
  efficiencyIndex: {
    score: number;
    targetScore: number;
    status: 'below-target' | 'on-target';
    components: {
      throughputScore: number;
      latencyScore: number;
      completionScore: number;
      retryPenaltyScore: number;
    };
  };
  variance: {
    sampleCount: number;
    alerts: string[];
    deltas: {
      completedPerDayDelta: number;
      p95AdmissionToCompleteDeltaMs: number;
      completionRateDelta: number;
      retryRateDelta: number;
      efficiencyScoreDelta: number;
    };
  };
}

interface PercentileSummary {
  p50: number;
  p95: number;
  p99: number;
  average: number;
  sampleCount: number;
}

interface PersistedEfficiencySnapshot {
  metricsDir: string;
  historyFile: string;
  latestFile: string;
  usedFallback: boolean;
  warning?: string;
}

const METRICS_DIR = path.join('docs', 'metrics');
const HISTORY_FILE = path.join(METRICS_DIR, 'efficiency-history.jsonl');
const LATEST_FILE = path.join(METRICS_DIR, 'efficiency-latest.json');
const FALLBACK_METRICS_DIR = path.join('.hephaestus', 'metrics');

const TARGET_THROUGHPUT_PER_DAY = Number(process.env.EFF_TARGET_THROUGHPUT_PER_DAY ?? 16);
const TARGET_P95_ADMISSION_TO_COMPLETE_MS = Number(
  process.env.EFF_TARGET_P95_ADMISSION_TO_COMPLETE_MS ?? 30 * 60 * 1000
);
const TARGET_EFFICIENCY_SCORE = Number(process.env.EFF_TARGET_SCORE ?? 70);
const VARIANCE_WINDOW = Number(process.env.EFF_VARIANCE_WINDOW ?? 20);
const AUTOGEN_WEEKLY_REPORT = !['0', 'false', 'off'].includes(
  (process.env.EFF_AUTOGEN_WEEKLY_REPORT ?? '1').toLowerCase()
);

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function round(value: number): number {
  return Number(value.toFixed(3));
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index] ?? 0;
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function summarize(values: number[]): PercentileSummary {
  return {
    p50: round(percentile(values, 50)),
    p95: round(percentile(values, 95)),
    p99: round(percentile(values, 99)),
    average: round(average(values)),
    sampleCount: values.length,
  };
}

function statusCount(tickets: TaskTicket[], status: TaskStatus): number {
  return tickets.filter((ticket) => ticket.status === status).length;
}

function stdDev(values: number[]): number {
  if (values.length <= 1) {
    return 0;
  }

  const mean = average(values);
  const variance = average(values.map((value) => (value - mean) ** 2));
  return Math.sqrt(variance);
}

function formatMs(value: number): string {
  return `${Math.round(value)}ms`;
}

async function loadHistory(): Promise<EfficiencySnapshot[]> {
  try {
    const content = await fs.readFile(HISTORY_FILE, 'utf-8');
    return content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as EfficiencySnapshot);
  } catch {
    return [];
  }
}

function buildVariance(
  history: EfficiencySnapshot[],
  current: Omit<EfficiencySnapshot, 'variance'>
): EfficiencySnapshot['variance'] {
  if (history.length === 0) {
    return {
      sampleCount: 1,
      alerts: [],
      deltas: {
        completedPerDayDelta: 0,
        p95AdmissionToCompleteDeltaMs: 0,
        completionRateDelta: 0,
        retryRateDelta: 0,
        efficiencyScoreDelta: 0,
      },
    };
  }

  const window = history.slice(-VARIANCE_WINDOW);
  const latest = history[history.length - 1];

  const throughputSeries = window.map((entry) => entry.throughput.completedPerDay);
  const p95Series = window.map((entry) => entry.latencyMs.admissionToComplete.p95);
  const completionSeries = window.map((entry) => entry.quality.completionRate);
  const retrySeries = window.map((entry) => entry.quality.retryRate);
  const allowlistDenialSeries = window.map((entry) => entry.policy?.allowlistDenialRate ?? 0);
  const scoreSeries = window.map((entry) => entry.efficiencyIndex.score);

  const alerts: string[] = [];

  const evaluateZScore = (label: string, value: number, series: number[]): void => {
    const sigma = stdDev(series);
    if (sigma === 0) {
      return;
    }

    const z = (value - average(series)) / sigma;
    if (Math.abs(z) >= 2) {
      alerts.push(`${label} variance alert z=${round(z)}`);
    }
  };

  evaluateZScore('throughput', current.throughput.completedPerDay, throughputSeries);
  evaluateZScore('p95-admission-to-complete-ms', current.latencyMs.admissionToComplete.p95, p95Series);
  evaluateZScore('completion-rate', current.quality.completionRate, completionSeries);
  evaluateZScore('retry-rate', current.quality.retryRate, retrySeries);
  evaluateZScore('allowlist-denial-rate', current.policy.allowlistDenialRate, allowlistDenialSeries);
  evaluateZScore('efficiency-score', current.efficiencyIndex.score, scoreSeries);

  return {
    sampleCount: window.length + 1,
    alerts,
    deltas: {
      completedPerDayDelta: round(current.throughput.completedPerDay - latest.throughput.completedPerDay),
      p95AdmissionToCompleteDeltaMs: round(
        current.latencyMs.admissionToComplete.p95 - latest.latencyMs.admissionToComplete.p95
      ),
      completionRateDelta: round(current.quality.completionRate - latest.quality.completionRate),
      retryRateDelta: round(current.quality.retryRate - latest.quality.retryRate),
      efficiencyScoreDelta: round(current.efficiencyIndex.score - latest.efficiencyIndex.score),
    },
  };
}

function printHumanSummary(snapshot: EfficiencySnapshot): void {
  const statusLine = snapshot.efficiencyIndex.status === 'on-target'
    ? 'on-target'
    : 'below-target';

  console.log(`Efficiency score: ${snapshot.efficiencyIndex.score} (${statusLine})`);
  console.log(`Throughput/day: ${snapshot.throughput.completedPerDay}`);
  console.log(
    `p95 admission->complete: ${formatMs(snapshot.latencyMs.admissionToComplete.p95)}`
  );
  console.log(`Completion rate: ${snapshot.quality.completionRate}`);
  console.log(`Retry rate: ${snapshot.quality.retryRate}`);

  if (snapshot.variance.alerts.length > 0) {
    console.log(`Variance alerts: ${snapshot.variance.alerts.join('; ')}`);
  }
}

async function collectSnapshot(): Promise<EfficiencySnapshot> {
  const repository = new TicketStoreRepository({ projectionEnabled: false });
  try {
    const tickets = await repository.listTickets('all');
    const attemptsByTicket = await repository.listAttemptsForTickets(tickets.map((ticket) => ticket.id));

    const now = Date.now();
    const completedLast24h = tickets.filter((ticket) => {
      if (!(ticket.completedAt instanceof Date)) {
        return false;
      }

      return now - ticket.completedAt.getTime() <= 24 * 60 * 60 * 1000;
    }).length;

    const admissionToStart: number[] = [];
    const startToComplete: number[] = [];
    const admissionToComplete: number[] = [];

    for (const ticket of tickets) {
      const createdAt = ticket.createdAt.getTime();
      const startedAt = ticket.startedAt?.getTime();
      const completedAt = ticket.completedAt?.getTime();

      if (startedAt) {
        admissionToStart.push(Math.max(0, startedAt - createdAt));
      }

      if (startedAt && completedAt) {
        startToComplete.push(Math.max(0, completedAt - startedAt));
      }

      if (completedAt) {
        admissionToComplete.push(Math.max(0, completedAt - createdAt));
      }
    }

    const attempts = [...attemptsByTicket.values()].flat();
    const retryTicketCount = tickets.filter((ticket) => ticket.attemptCount > 1).length;
    const completedCount = statusCount(tickets, 'completed');
    const blockedCount = statusCount(tickets, 'blocked');
    const awaitingApprovalCount = statusCount(tickets, 'awaiting_approval');
    const pendingCount = statusCount(tickets, 'pending');
    const inProgressCount = statusCount(tickets, 'in_progress');
    const cancelledCount = statusCount(tickets, 'cancelled');

    const throughputPerDay = round(completedLast24h);
    const retryRate = tickets.length === 0 ? 0 : retryTicketCount / tickets.length;
    const blockRate = tickets.length === 0 ? 0 : blockedCount / tickets.length;
    const approvalRate = tickets.length === 0 ? 0 : awaitingApprovalCount / tickets.length;
    const completionRate = tickets.length === 0 ? 0 : completedCount / tickets.length;
    const allowlistDenialCount = tickets.filter((ticket) => /allowlisted/i.test(ticket.error ?? '')).length;
    const allowlistDenialRate = tickets.length === 0 ? 0 : allowlistDenialCount / tickets.length;

    const latencySummary = {
      admissionToStart: summarize(admissionToStart),
      startToComplete: summarize(startToComplete),
      admissionToComplete: summarize(admissionToComplete),
    };

    const throughputScore = clamp01(throughputPerDay / Math.max(1, TARGET_THROUGHPUT_PER_DAY));
    const latencyScore = clamp01(
      TARGET_P95_ADMISSION_TO_COMPLETE_MS /
        Math.max(1, latencySummary.admissionToComplete.p95 || TARGET_P95_ADMISSION_TO_COMPLETE_MS)
    );
    const completionScore = clamp01(completionRate);
    const retryPenaltyScore = clamp01(1 - retryRate);

    const score = round(
      100 * (0.35 * throughputScore + 0.35 * latencyScore + 0.2 * completionScore + 0.1 * retryPenaltyScore)
    );

    const baseSnapshot: Omit<EfficiencySnapshot, 'variance'> = {
      timestamp: new Date().toISOString(),
      totals: {
        tickets: tickets.length,
        attempts: attempts.length,
        completed: completedCount,
        blocked: blockedCount,
        awaitingApproval: awaitingApprovalCount,
        pending: pendingCount,
        inProgress: inProgressCount,
        cancelled: cancelledCount,
      },
      throughput: {
        completedLast24h,
        completedPerDay: throughputPerDay,
      },
      latencyMs: latencySummary,
      quality: {
        retryRate: round(retryRate),
        blockRate: round(blockRate),
        approvalRate: round(approvalRate),
        completionRate: round(completionRate),
      },
      policy: {
        allowlistDenialCount,
        allowlistDenialRate: round(allowlistDenialRate),
      },
      efficiencyIndex: {
        score,
        targetScore: TARGET_EFFICIENCY_SCORE,
        status: score >= TARGET_EFFICIENCY_SCORE ? 'on-target' : 'below-target',
        components: {
          throughputScore: round(throughputScore),
          latencyScore: round(latencyScore),
          completionScore: round(completionScore),
          retryPenaltyScore: round(retryPenaltyScore),
        },
      },
    };

    const history = await loadHistory();
    const variance = buildVariance(history, baseSnapshot);

    return {
      ...baseSnapshot,
      variance,
    };
  } finally {
    await repository.stop();
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isTransientFileError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === 'EPERM' || code === 'EBUSY';
}

async function runFileOperationWithRetry(description: string, operation: () => Promise<void>): Promise<void> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await operation();
      return;
    } catch (error) {
      lastError = error;
      if (!isTransientFileError(error)) {
        throw error;
      }

      await delay(50 * (attempt + 1));
    }
  }

  throw new Error(`${description} failed after retries: ${formatError(lastError)}`);
}

async function writeSnapshotFiles(
  metricsDir: string,
  snapshot: EfficiencySnapshot,
  usedFallback: boolean,
  warning?: string
): Promise<PersistedEfficiencySnapshot> {
  const historyFile = metricsDir === METRICS_DIR
    ? HISTORY_FILE
    : path.join(metricsDir, 'efficiency-history.jsonl');
  const latestFile = metricsDir === METRICS_DIR
    ? LATEST_FILE
    : path.join(metricsDir, 'efficiency-latest.json');

  await runFileOperationWithRetry(`creating metrics directory ${metricsDir}`, async () => {
    await fs.mkdir(metricsDir, { recursive: true });
  });
  await runFileOperationWithRetry(`appending efficiency history ${historyFile}`, async () => {
    await fs.appendFile(historyFile, `${JSON.stringify(snapshot)}\n`, 'utf-8');
  });
  await runFileOperationWithRetry(`writing latest efficiency snapshot ${latestFile}`, async () => {
    await fs.writeFile(latestFile, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf-8');
  });

  return {
    metricsDir,
    historyFile,
    latestFile,
    usedFallback,
    warning,
  };
}

async function persistSnapshot(snapshot: EfficiencySnapshot): Promise<PersistedEfficiencySnapshot> {
  try {
    return await writeSnapshotFiles(METRICS_DIR, snapshot, false);
  } catch (error) {
    if (!isTransientFileError(error) && !(error instanceof Error && error.message.includes('failed after retries'))) {
      throw error;
    }

    const warning = `Primary metrics path unavailable; wrote fallback metrics to ${FALLBACK_METRICS_DIR}. Cause: ${formatError(error)}`;
    return writeSnapshotFiles(FALLBACK_METRICS_DIR, snapshot, true, warning);
  }
}

async function main(): Promise<void> {
  const snapshot = await collectSnapshot();
  const persisted = await persistSnapshot(snapshot);
  if (persisted.warning) {
    console.warn(persisted.warning);
  }

  if (AUTOGEN_WEEKLY_REPORT && !persisted.usedFallback) {
    try {
      const reportPath = await generateWeeklyEfficiencyReport();
      console.log(`Weekly report updated: ${reportPath}`);
    } catch (error) {
      console.warn(`Weekly report generation skipped: ${formatError(error)}`);
    }
  } else if (AUTOGEN_WEEKLY_REPORT) {
    console.warn('Weekly report generation skipped because primary efficiency history was unavailable.');
  }

  printHumanSummary(snapshot);
}

main().catch((error) => {
  console.error('Failed to collect efficiency metrics:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
