import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { TicketStoreRepository } from './task-store.js';
import { computeOperationalSLOMetrics, formatOperationalSLOMetrics, type OperationalSLOMetrics } from './slo-metrics.js';
import type { Task, TaskTicket } from './types.js';

export interface FaultScenarioResult {
  name: string;
  passed: boolean;
  details: string;
}

export interface FaultHarnessReport {
  rootDir: string;
  scenarios: FaultScenarioResult[];
}

export interface SoakWorkloadReport {
  rootDir: string;
  ticketCount: number;
  metrics: OperationalSLOMetrics;
}

function withCompletedTask(ticket: TaskTicket, result = 'Plan ready'): Task {
  return {
    ...ticket,
    status: 'completed',
    result,
  };
}

function withBlockedTask(ticket: TaskTicket, error: string): Task {
  return {
    ...ticket,
    status: 'blocked',
    error,
  };
}

function withAwaitingApprovalTask(ticket: TaskTicket, error: string): Task {
  return {
    ...ticket,
    status: 'awaiting_approval',
    error,
  };
}

async function waitFor(assertion: () => boolean | Promise<boolean>, timeoutMs = 1_000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await assertion()) {
      return;
    }

    await delay(10);
  }

  throw new Error('Timed out waiting for reliability harness condition.');
}

async function collectRepositoryMetrics(repository: TicketStoreRepository): Promise<OperationalSLOMetrics> {
  const tickets = await repository.listTickets('all');
  const attemptsByTicket = new Map(
    await Promise.all(
      tickets.map(async (ticket) => [ticket.id, await repository.listAttempts(ticket.id)] as const)
    )
  );
  const events = await repository.listEvents();

  return computeOperationalSLOMetrics({ tickets, attemptsByTicket, events });
}

export async function runFaultInjectionHarness(): Promise<FaultHarnessReport> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'Hephaestus-fault-harness-'));
  const tasksFile = path.join(rootDir, 'TASKS.md');
  const storeFile = path.join(rootDir, '.hephaestus-tickets.db');
  const scenarios: FaultScenarioResult[] = [];

  let locked = true;
  const projectionRepository = new TicketStoreRepository({
    tasksFile,
    storeFile,
    importLegacyTaskBoardIfStoreEmpty: false,
    projectionEnabled: true,
    projectionRetryDelayMs: 10,
    projectionRetryMaxDelayMs: 20,
    projectionWriter: async (targetPath, content) => {
      if (locked) {
        throw new Error('TASKS.md is temporarily locked');
      }

      await fs.writeFile(targetPath, content, 'utf-8');
    },
  });

  try {
    await projectionRepository.createTicket('Recover from projection lock contention');
    await waitFor(() => projectionRepository.getProjectionHealthStatus().retryScheduled, 1_000);
    locked = false;
    await waitFor(async () => {
      try {
        const board = await fs.readFile(tasksFile, 'utf-8');
        return board.includes('Recover from projection lock contention');
      } catch {
        return false;
      }
    }, 1_000);
    await waitFor(() => {
      const status = projectionRepository.getProjectionHealthStatus();
      return status.healthy && !status.retryScheduled;
    }, 1_000);

    scenarios.push({
      name: 'projection-lock-contention',
      passed: projectionRepository.getProjectionHealthStatus().healthy,
      details: projectionRepository.getProjectionHealthStatus().healthy
        ? 'Projection retry recovered automatically after the lock released.'
        : `Projection remained unhealthy: ${projectionRepository.getProjectionHealthStatus().lastError ?? 'unknown error'}`,
    });
  } finally {
    await projectionRepository.stop();
  }

  const restartRepository = new TicketStoreRepository({
    tasksFile,
    storeFile,
    importLegacyTaskBoardIfStoreEmpty: false,
    projectionEnabled: false,
  });
  try {
    const ticket = await restartRepository.createTicket('Survive mid-transition restart');
    await restartRepository.markTaskInProgress(ticket);
    await restartRepository.stop();

    const reopenedRepository = new TicketStoreRepository({
      tasksFile,
      storeFile,
      importLegacyTaskBoardIfStoreEmpty: false,
      projectionEnabled: false,
    });
    try {
      const reopenedTicket = await reopenedRepository.getTicket(ticket.id);
      const attempts = await reopenedRepository.listAttempts(ticket.id);
      scenarios.push({
        name: 'mid-transition-restart',
        passed: reopenedTicket?.status === 'in_progress' && attempts.some((attempt) => attempt.status === 'in_progress'),
        details: reopenedTicket?.status === 'in_progress'
          ? 'Ticket and in-progress attempt survived repository restart.'
          : `Unexpected restarted ticket state: ${reopenedTicket?.status ?? 'missing ticket'}`,
      });
    } finally {
      await reopenedRepository.stop();
    }
  } catch (error) {
    scenarios.push({
      name: 'mid-transition-restart',
      passed: false,
      details: error instanceof Error ? error.message : String(error),
    });
  }

  return { rootDir, scenarios };
}

export async function runSyntheticSoakWorkload(options: { ticketCount?: number } = {}): Promise<SoakWorkloadReport> {
  const ticketCount = Math.max(4, options.ticketCount ?? 12);
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'Hephaestus-soak-'));
  const repository = new TicketStoreRepository({
    tasksFile: path.join(rootDir, 'TASKS.md'),
    storeFile: path.join(rootDir, '.hephaestus-tickets.db'),
    importLegacyTaskBoardIfStoreEmpty: false,
    projectionEnabled: true,
  });

  try {
    for (let index = 0; index < ticketCount; index++) {
      const ticket = await repository.createTicket(`Synthetic workload ticket ${index + 1}`);
      await repository.markTaskInProgress(ticket);

      if (index % 4 === 0) {
        await repository.markTaskCompleted(withCompletedTask(ticket, `Completed workload ${index + 1}`));
        continue;
      }

      if (index % 4 === 1) {
        await repository.markTaskBlocked(withBlockedTask(ticket, 'Backend timeout: synthetic intermittency'));
        const retriedTicket = await repository.retryTicket(ticket.id);
        await repository.markTaskInProgress(retriedTicket);
        await repository.markTaskCompleted(withCompletedTask(retriedTicket, `Recovered workload ${index + 1}`));
        continue;
      }

      if (index % 4 === 2) {
        await repository.markTaskAwaitingApproval(
          withAwaitingApprovalTask(ticket, 'Patch requires approval before apply: patch touches 2 files')
        );
        continue;
      }

      await repository.markTaskBlocked(withBlockedTask(ticket, 'Command failed: npm test'));
    }

    await repository.syncProjection();
    const metrics = await collectRepositoryMetrics(repository);
    return {
      rootDir,
      ticketCount,
      metrics,
    };
  } finally {
    await repository.stop();
  }
}

export function formatReliabilityBaselineMarkdown(report: SoakWorkloadReport): string {
  const taxonomyEntries = Object.entries(report.metrics.failureTaxonomyCounts);

  return [
    '# Hephaestus Reliability Baselines',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    '## Synthetic Soak Workload',
    '',
    `- Ticket count: ${report.ticketCount}`,
    `- Workspace root: ${report.rootDir}`,
    `- Completed tickets: ${report.metrics.completedTickets}`,
    `- Blocked tickets: ${report.metrics.blockedTickets}`,
    `- Awaiting approval tickets: ${report.metrics.awaitingApprovalTickets}`,
    `- State consistency lag (ms): ${report.metrics.stateConsistencyLagMs}`,
    `- Average admission-to-start latency (ms): ${report.metrics.averageAdmissionToStartLatencyMs.toFixed(2)}`,
    `- Blocked-retry success ratio: ${report.metrics.blockedRetrySuccessRatio.toFixed(2)}`,
    `- Execution failure taxonomy stability: ${report.metrics.executionFailureTaxonomyStability.toFixed(2)}`,
    '',
    '## Failure Taxonomies',
    '',
    ...(taxonomyEntries.length === 0
      ? ['- none observed']
      : taxonomyEntries.map(([taxonomy, count]) => `- ${taxonomy}: ${count}`)),
    '',
    '## Operator Summary',
    '',
    '```text',
    formatOperationalSLOMetrics(report.metrics),
    '```',
    '',
  ].join('\n');
}

export async function publishReliabilityBaseline(outputPath: string, ticketCount?: number): Promise<SoakWorkloadReport> {
  const report = await runSyntheticSoakWorkload({ ticketCount });
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, formatReliabilityBaselineMarkdown(report), 'utf-8');
  return report;
}

function parseFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const mode = parseFlag(args, '--mode') ?? 'soak';

  switch (mode) {
    case 'fault': {
      const report = await runFaultInjectionHarness();
      for (const scenario of report.scenarios) {
        console.log(`${scenario.passed ? 'PASS' : 'FAIL'}\t${scenario.name}\t${scenario.details}`);
      }
      console.log(`workspace\t${report.rootDir}`);
      return;
    }

    case 'publish': {
      const outputPath = parseFlag(args, '--out')
        ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'reliability-baselines.md');
      const ticketCount = Number.parseInt(parseFlag(args, '--tickets') ?? '12', 10);
      const report = await publishReliabilityBaseline(outputPath, Number.isFinite(ticketCount) ? ticketCount : 12);
      console.log(`Published reliability baselines to ${outputPath}`);
      console.log(formatOperationalSLOMetrics(report.metrics));
      return;
    }

    case 'soak': {
      const ticketCount = Number.parseInt(parseFlag(args, '--tickets') ?? '12', 10);
      const report = await runSyntheticSoakWorkload({ ticketCount: Number.isFinite(ticketCount) ? ticketCount : 12 });
      console.log(`Synthetic soak workspace: ${report.rootDir}`);
      console.log(formatOperationalSLOMetrics(report.metrics));
      return;
    }

    default:
      throw new Error(`Unknown reliability harness mode: ${mode}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}