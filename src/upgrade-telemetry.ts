import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TicketStoreRepository } from './task-store.js';
import type { TaskAttempt, TaskStatus, TaskTicket } from './types.js';

interface PercentileSummary {
  p50: number;
  p95: number;
  max: number;
  average: number;
  sampleCount: number;
}

interface UpgradeTelemetrySnapshot {
  timestamp: string;
  queue: {
    total: number;
    pending: number;
    inProgress: number;
    awaitingApproval: number;
    blocked: number;
    failed: number;
    stale: number;
    completed: number;
    superseded: number;
    cancelled: number;
    queuePressureIndex: number;
  };
  pendingAgeHours: PercentileSummary;
  execution: {
    attempts: number;
    attemptsPerTicket: number;
    retryRate: number;
    startedLast24h: number;
    completedLast24h: number;
    admissionToStartMs: PercentileSummary;
  };
  churn: {
    terminalCount: number;
    supersededRate: number;
    cancelledRate: number;
    supersededToCompletedRatio: number;
  };
  policy: {
    allowlistDenialCount: number;
    allowlistDenialRate: number;
    topFailureBuckets: Array<{ bucket: string; count: number }>;
  };
  rootCauses: {
    topDenyReasons: Array<{ bucket: string; count: number }>;
    topSupersedeReasons: Array<{ bucket: string; count: number }>;
    topRetryReasons: Array<{ bucket: string; count: number }>;
  };
  observationTargets: {
    supersededRateMax: number;
    allowlistDenialRateMax: number;
    pendingP95AgeHoursMax: number;
    queuePressureIndexMax: number;
  };
  alerts: string[];
}

const METRICS_DIR = path.join('docs', 'metrics');
const LATEST_FILE = path.join(METRICS_DIR, 'upgrade-telemetry-latest.json');
const HISTORY_FILE = path.join(METRICS_DIR, 'upgrade-telemetry-history.jsonl');
const REPORT_FILE = path.join(METRICS_DIR, 'upgrade-telemetry-report.md');

const terminalStatuses = new Set<TaskStatus>(['completed', 'superseded', 'cancelled']);

function round(value: number): number {
  return Number(value.toFixed(3));
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index] ?? 0;
}

function summarize(values: number[]): PercentileSummary {
  return {
    p50: round(percentile(values, 50)),
    p95: round(percentile(values, 95)),
    max: round(values.length > 0 ? Math.max(...values) : 0),
    average: round(average(values)),
    sampleCount: values.length,
  };
}

function normalizeFailureBucket(error: string): string {
  const normalized = error.trim().toLowerCase();
  const bucket = normalized.split(/[:.;]/, 1)[0] ?? normalized;
  return bucket.replace(/\s+/g, ' ').slice(0, 72);
}

function topBuckets(entries: Iterable<string>, limit = 3): Array<{ bucket: string; count: number }> {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const bucket = normalizeFailureBucket(entry);
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([bucket, count]) => ({ bucket, count }));
}

function countTicketsByStatus(tickets: TaskTicket[], status: TaskStatus): number {
  return tickets.filter((ticket) => ticket.status === status).length;
}

export function buildUpgradeTelemetrySnapshot(input: {
  tickets: TaskTicket[];
  attempts: TaskAttempt[];
  now?: number;
}): UpgradeTelemetrySnapshot {
  const now = input.now ?? Date.now();
  const tickets = input.tickets;
  const attempts = input.attempts;

  const pending = countTicketsByStatus(tickets, 'pending');
  const inProgress = countTicketsByStatus(tickets, 'in_progress');
  const awaitingApproval = countTicketsByStatus(tickets, 'awaiting_approval');
  const blocked = countTicketsByStatus(tickets, 'blocked');
  const failed = countTicketsByStatus(tickets, 'failed');
  const stale = countTicketsByStatus(tickets, 'stale');
  const completed = countTicketsByStatus(tickets, 'completed');
  const superseded = countTicketsByStatus(tickets, 'superseded');
  const cancelled = countTicketsByStatus(tickets, 'cancelled');

  const pendingAgeHours = summarize(
    tickets
      .filter((ticket) => ticket.status === 'pending')
      .map((ticket) => Math.max(0, (now - ticket.createdAt.getTime()) / (60 * 60 * 1000)))
  );

  const startedLast24h = attempts.filter((attempt) => now - attempt.startedAt.getTime() <= 24 * 60 * 60 * 1000).length;
  const completedLast24h = tickets.filter((ticket) => {
    if (!(ticket.completedAt instanceof Date)) {
      return false;
    }
    return now - ticket.completedAt.getTime() <= 24 * 60 * 60 * 1000;
  }).length;

  const admissionToStartMs = summarize(
    tickets
      .filter((ticket) => ticket.startedAt instanceof Date)
      .map((ticket) => Math.max(0, (ticket.startedAt?.getTime() ?? 0) - ticket.createdAt.getTime()))
  );

  const retriedTicketCount = tickets.filter((ticket) => ticket.attemptCount > 1).length;
  const terminalCount = tickets.filter((ticket) => terminalStatuses.has(ticket.status)).length;

  const failureBuckets = new Map<string, number>();
  let allowlistDenialCount = 0;
  for (const attempt of attempts) {
    if (!attempt.error) {
      continue;
    }

    const bucket = normalizeFailureBucket(attempt.error);
    failureBuckets.set(bucket, (failureBuckets.get(bucket) ?? 0) + 1);

    if (/allowlist|allowlisted/i.test(attempt.error)) {
      allowlistDenialCount += 1;
    }
  }

  const topFailureBuckets = [...failureBuckets.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 7)
    .map(([bucket, count]) => ({ bucket, count }));

  const topDenyReasons = topBuckets(
    attempts
      .filter((attempt) => /allowlist|allowlisted/i.test(attempt.error ?? ''))
      .map((attempt) => attempt.error ?? 'allowlisted')
  );

  const topSupersedeReasons = topBuckets(
    tickets
      .filter((ticket) => ticket.status === 'superseded')
      .map((ticket) => ticket.error ?? ticket.result ?? ticket.description)
  );

  const topRetryReasons = topBuckets(
    tickets
      .filter((ticket) => ticket.attemptCount > 1)
      .map((ticket) => ticket.error ?? ticket.result ?? ticket.description)
  );

  const queuePressureIndex = round(
    (pending + inProgress * 1.4 + awaitingApproval * 1.15 + blocked * 0.8 + failed * 0.8 + stale * 0.8) /
      Math.max(1, tickets.length)
  );

  const snapshot: UpgradeTelemetrySnapshot = {
    timestamp: new Date(now).toISOString(),
    queue: {
      total: tickets.length,
      pending,
      inProgress,
      awaitingApproval,
      blocked,
      failed,
      stale,
      completed,
      superseded,
      cancelled,
      queuePressureIndex,
    },
    pendingAgeHours,
    execution: {
      attempts: attempts.length,
      attemptsPerTicket: round(attempts.length / Math.max(1, tickets.length)),
      retryRate: round(retriedTicketCount / Math.max(1, tickets.length)),
      startedLast24h,
      completedLast24h,
      admissionToStartMs,
    },
    churn: {
      terminalCount,
      supersededRate: round(superseded / Math.max(1, terminalCount)),
      cancelledRate: round(cancelled / Math.max(1, terminalCount)),
      supersededToCompletedRatio: round(superseded / Math.max(1, completed)),
    },
    policy: {
      allowlistDenialCount,
      allowlistDenialRate: round(allowlistDenialCount / Math.max(1, attempts.length)),
      topFailureBuckets,
    },
    rootCauses: {
      topDenyReasons,
      topSupersedeReasons,
      topRetryReasons,
    },
    observationTargets: {
      supersededRateMax: 0.18,
      allowlistDenialRateMax: 0.08,
      pendingP95AgeHoursMax: 36,
      queuePressureIndexMax: 0.65,
    },
    alerts: [],
  };

  const alerts: string[] = [];
  if (snapshot.churn.supersededRate > snapshot.observationTargets.supersededRateMax) {
    alerts.push(`superseded-rate-high:${snapshot.churn.supersededRate}`);
  }
  if (snapshot.policy.allowlistDenialRate > snapshot.observationTargets.allowlistDenialRateMax) {
    alerts.push(`allowlist-denial-rate-high:${snapshot.policy.allowlistDenialRate}`);
  }
  if (snapshot.pendingAgeHours.p95 > snapshot.observationTargets.pendingP95AgeHoursMax) {
    alerts.push(`pending-age-p95-high:${snapshot.pendingAgeHours.p95}h`);
  }
  if (snapshot.queue.queuePressureIndex > snapshot.observationTargets.queuePressureIndexMax) {
    alerts.push(`queue-pressure-high:${snapshot.queue.queuePressureIndex}`);
  }
  if (snapshot.execution.completedLast24h === 0) {
    alerts.push('no-completions-last-24h');
  }
  snapshot.alerts = alerts;

  return snapshot;
}

function renderReport(snapshot: UpgradeTelemetrySnapshot): string {
  return [
    '# Upgrade Telemetry Report',
    '',
    `Generated: ${snapshot.timestamp}`,
    '',
    '## Queue',
    `- Total tickets: ${snapshot.queue.total}`,
    `- Pending tickets: ${snapshot.queue.pending}`,
    `- In progress tickets: ${snapshot.queue.inProgress}`,
    `- Queue pressure index: ${snapshot.queue.queuePressureIndex}`,
    '',
    '## Aging',
    `- Pending age p50 (h): ${snapshot.pendingAgeHours.p50}`,
    `- Pending age p95 (h): ${snapshot.pendingAgeHours.p95}`,
    `- Pending age max (h): ${snapshot.pendingAgeHours.max}`,
    '',
    '## Execution',
    `- Attempts: ${snapshot.execution.attempts}`,
    `- Attempts per ticket: ${snapshot.execution.attemptsPerTicket}`,
    `- Retry rate: ${snapshot.execution.retryRate}`,
    `- Started last 24h: ${snapshot.execution.startedLast24h}`,
    `- Completed last 24h: ${snapshot.execution.completedLast24h}`,
    `- Admission->start p95 (ms): ${snapshot.execution.admissionToStartMs.p95}`,
    '',
    '## Churn',
    `- Superseded rate: ${snapshot.churn.supersededRate}`,
    `- Cancelled rate: ${snapshot.churn.cancelledRate}`,
    `- Superseded/completed ratio: ${snapshot.churn.supersededToCompletedRatio}`,
    '',
    '## Policy',
    `- Allowlist denial count: ${snapshot.policy.allowlistDenialCount}`,
    `- Allowlist denial rate: ${snapshot.policy.allowlistDenialRate}`,
    ...(snapshot.policy.topFailureBuckets.length > 0
      ? snapshot.policy.topFailureBuckets.map((entry) => `- Failure bucket ${entry.bucket}: ${entry.count}`)
      : ['- Failure buckets: none observed']),
    '',
    '## Root Causes (Top-3)',
    ...(snapshot.rootCauses.topDenyReasons.length > 0
      ? snapshot.rootCauses.topDenyReasons.map((entry) => `- Deny reason ${entry.bucket}: ${entry.count}`)
      : ['- Deny reasons: none observed']),
    ...(snapshot.rootCauses.topSupersedeReasons.length > 0
      ? snapshot.rootCauses.topSupersedeReasons.map((entry) => `- Supersede reason ${entry.bucket}: ${entry.count}`)
      : ['- Supersede reasons: none observed']),
    ...(snapshot.rootCauses.topRetryReasons.length > 0
      ? snapshot.rootCauses.topRetryReasons.map((entry) => `- Retry reason ${entry.bucket}: ${entry.count}`)
      : ['- Retry reasons: none observed']),
    '',
    '## Alerts',
    ...(snapshot.alerts.length > 0 ? snapshot.alerts.map((entry) => `- ${entry}`) : ['- none']),
    '',
  ].join('\n');
}

async function collectSnapshot(): Promise<UpgradeTelemetrySnapshot> {
  const repository = new TicketStoreRepository({ projectionEnabled: false });
  try {
    const tickets = await repository.listTickets('all');
    const attemptsByTicket = await repository.listAttemptsForTickets(tickets.map((ticket) => ticket.id));
    const attempts = [...attemptsByTicket.values()].flat();
    return buildUpgradeTelemetrySnapshot({ tickets, attempts });
  } finally {
    await repository.stop();
  }
}

async function persist(snapshot: UpgradeTelemetrySnapshot): Promise<void> {
  await fs.mkdir(METRICS_DIR, { recursive: true });
  await fs.writeFile(LATEST_FILE, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf-8');
  await fs.appendFile(HISTORY_FILE, `${JSON.stringify(snapshot)}\n`, 'utf-8');
  await fs.writeFile(REPORT_FILE, `${renderReport(snapshot)}\n`, 'utf-8');
}

async function main(): Promise<void> {
  const snapshot = await collectSnapshot();
  await persist(snapshot);
  console.log(`Upgrade telemetry written to ${LATEST_FILE}`);
  console.log(`Queue pressure index: ${snapshot.queue.queuePressureIndex}`);
  console.log(`Superseded rate: ${snapshot.churn.supersededRate}`);
  console.log(`Allowlist denial rate: ${snapshot.policy.allowlistDenialRate}`);
  if (snapshot.alerts.length > 0) {
    console.log(`Alerts: ${snapshot.alerts.join('; ')}`);
  }
}

function isDirectExecution(): boolean {
  if (!process.argv[1]) {
    return false;
  }

  return path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isDirectExecution()) {
  main().catch((error) => {
    console.error(
      'Failed to collect upgrade telemetry:',
      error instanceof Error ? error.message : String(error)
    );
    process.exit(1);
  });
}
