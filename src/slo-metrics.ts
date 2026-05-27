import type { TaskAttempt, TaskEvent, TaskTicket } from './types.js';

export interface OperationalSLOMetrics {
  totalTickets: number;
  totalAttempts: number;
  completedTickets: number;
  blockedTickets: number;
  awaitingApprovalTickets: number;
  stateConsistencyLagMs: number;
  averageAdmissionToStartLatencyMs: number;
  blockedRetrySuccessRatio: number;
  executionFailureTaxonomyStability: number;
  failureTaxonomyCounts: Record<string, number>;
  lastBoardSyncAt?: Date;
}

function average(values: number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function normalizeFailureTaxonomy(error: string): string {
  const normalized = error.trim().toLowerCase();
  const prefix = normalized.split(/[:;]/, 1)[0] ?? normalized;
  return prefix.replace(/\s+/g, ' ');
}

export function computeOperationalSLOMetrics(input: {
  tickets: TaskTicket[];
  attemptsByTicket: Map<string, TaskAttempt[]>;
  events: TaskEvent[];
}): OperationalSLOMetrics {
  const createdAtByTicket = new Map<string, Date>();
  const startedAtByTicket = new Map<string, Date>();
  let lastBoardSyncAt: Date | undefined;

  for (const event of input.events) {
    if (event.type === 'created' && !createdAtByTicket.has(event.ticketId)) {
      createdAtByTicket.set(event.ticketId, event.createdAt);
    }

    if (
      (event.type === 'attempt-started' || event.type === 'claimed') &&
      !startedAtByTicket.has(event.ticketId)
    ) {
      startedAtByTicket.set(event.ticketId, event.createdAt);
    }

    if (event.type === 'board-synced') {
      lastBoardSyncAt = !lastBoardSyncAt || event.createdAt > lastBoardSyncAt
        ? event.createdAt
        : lastBoardSyncAt;
    }
  }

  const admissionLatencies = input.tickets.flatMap((ticket) => {
    const createdAt = createdAtByTicket.get(ticket.id);
    const startedAt = startedAtByTicket.get(ticket.id);
    if (!createdAt || !startedAt) {
      return [];
    }

    return [Math.max(0, startedAt.getTime() - createdAt.getTime())];
  });

  let blockedRetryPopulation = 0;
  let blockedRetrySuccesses = 0;
  const failureTaxonomyCounts = new Map<string, number>();

  for (const attempts of input.attemptsByTicket.values()) {
    const blockedAttemptIndex = attempts.findIndex((attempt) => attempt.status === 'blocked');
    if (blockedAttemptIndex !== -1) {
      blockedRetryPopulation += 1;
      if (attempts.slice(blockedAttemptIndex + 1).some((attempt) => attempt.status === 'completed')) {
        blockedRetrySuccesses += 1;
      }
    }

    for (const attempt of attempts) {
      if (!attempt.error) {
        continue;
      }

      const taxonomy = normalizeFailureTaxonomy(attempt.error);
      failureTaxonomyCounts.set(taxonomy, (failureTaxonomyCounts.get(taxonomy) ?? 0) + 1);
    }
  }

  const latestTicketUpdateMs = input.tickets.reduce(
    (latest, ticket) => Math.max(latest, ticket.updatedAt.getTime()),
    0
  );
  const boardSyncMs = lastBoardSyncAt?.getTime() ?? latestTicketUpdateMs;
  const failureCounts = [...failureTaxonomyCounts.values()];
  const dominantFailureCount = failureCounts.length === 0 ? 0 : Math.max(...failureCounts);
  const totalFailures = failureCounts.reduce((sum, value) => sum + value, 0);

  return {
    totalTickets: input.tickets.length,
    totalAttempts: [...input.attemptsByTicket.values()].reduce((sum, attempts) => sum + attempts.length, 0),
    completedTickets: input.tickets.filter((ticket) => ticket.status === 'completed').length,
    blockedTickets: input.tickets.filter((ticket) => ticket.status === 'blocked').length,
    awaitingApprovalTickets: input.tickets.filter((ticket) => ticket.status === 'awaiting_approval').length,
    stateConsistencyLagMs: Math.max(0, latestTicketUpdateMs - boardSyncMs),
    averageAdmissionToStartLatencyMs: average(admissionLatencies),
    blockedRetrySuccessRatio: blockedRetryPopulation === 0 ? 1 : blockedRetrySuccesses / blockedRetryPopulation,
    executionFailureTaxonomyStability: totalFailures === 0 ? 1 : dominantFailureCount / totalFailures,
    failureTaxonomyCounts: Object.fromEntries([...failureTaxonomyCounts.entries()].sort()),
    lastBoardSyncAt,
  };
}

export function formatOperationalSLOMetrics(metrics: OperationalSLOMetrics): string {
  const formatRatio = (value: number) => value.toFixed(2);
  const taxonomyEntries = Object.entries(metrics.failureTaxonomyCounts);

  return [
    `Total tickets: ${metrics.totalTickets}`,
    `Total attempts: ${metrics.totalAttempts}`,
    `Completed tickets: ${metrics.completedTickets}`,
    `Blocked tickets: ${metrics.blockedTickets}`,
    `Awaiting approval tickets: ${metrics.awaitingApprovalTickets}`,
    `State consistency lag (ms): ${metrics.stateConsistencyLagMs}`,
    `Average admission-to-start latency (ms): ${metrics.averageAdmissionToStartLatencyMs.toFixed(2)}`,
    `Blocked-retry success ratio: ${formatRatio(metrics.blockedRetrySuccessRatio)}`,
    `Execution failure taxonomy stability: ${formatRatio(metrics.executionFailureTaxonomyStability)}`,
    `Last board sync: ${metrics.lastBoardSyncAt?.toISOString() ?? '-'}`,
    taxonomyEntries.length === 0
      ? 'Failure taxonomies: none observed'
      : `Failure taxonomies: ${taxonomyEntries.map(([key, value]) => `${key}=${value}`).join(', ')}`,
  ].join('\n');
}