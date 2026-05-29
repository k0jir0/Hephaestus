import type { SelfAuditSeedOptions, SelfAuditSeedResult } from './self-audit.js';
import type { TaskStatus, TaskTicket } from './types.js';

const runnableStatuses = new Set<TaskStatus>([
  'pending',
  'in_progress',
  'planned',
  'applying',
  'verifying',
]);

const retryableStatuses = new Set<TaskStatus>(['blocked', 'failed', 'stale']);
const activeStatuses = new Set<TaskStatus>([
  'pending',
  'in_progress',
  'planned',
  'applying',
  'verifying',
  'awaiting_approval',
  'blocked',
  'failed',
  'stale',
]);
const terminalStatuses = new Set<TaskStatus>(['completed', 'superseded', 'cancelled']);

export interface TicketAutopilotRepository {
  listTickets(status?: TaskStatus | 'all'): Promise<TaskTicket[]>;
  retryTicket(ticketId: string): Promise<TaskTicket>;
  resumeApprovedTicket(ticketId: string): Promise<TaskTicket>;
}

export interface TicketAutopilotSeeder {
  seedTickets(options?: SelfAuditSeedOptions): Promise<SelfAuditSeedResult>;
}

export interface TicketAutopilotOptions {
  includeCancelled?: boolean;
  dryRun?: boolean;
  seedSelfAuditWhenIdle?: boolean;
  selfAuditLimit?: number;
  maxAttempts?: number;
  waveSize?: number;
  maxActiveTickets?: number;
  minCompletionRate?: number;
  maxSupersededRate?: number;
  maxBlockedTickets?: number;
  maxAllowlistDenialRate?: number;
}

export interface TicketAutopilotResult {
  runnableTicketCount: number;
  awaitingApprovalCount: number;
  activeTicketCount: number;
  availableWaveSlots: number;
  resumed: TaskTicket[];
  requeued: TaskTicket[];
  skippedRetryCap: TaskTicket[];
  blockedByGates: boolean;
  gateFailures: string[];
  selfAudit: SelfAuditSeedResult | null;
  queueReady: boolean;
}

function isRunnableTicket(ticket: TaskTicket): boolean {
  return runnableStatuses.has(ticket.status);
}

function isApprovedAwaitingApproval(ticket: TaskTicket): boolean {
  return ticket.status === 'awaiting_approval' && ticket.approval?.status === 'approved';
}

function isPendingOperatorApproval(ticket: TaskTicket): boolean {
  return ticket.status === 'awaiting_approval' && ticket.approval?.status !== 'approved';
}

function cloneAsPending(ticket: TaskTicket): TaskTicket {
  const now = new Date();
  return {
    ...ticket,
    status: 'pending',
    updatedAt: now,
    blockedAt: undefined,
    cancelledAt: undefined,
    currentAttemptId: undefined,
    error: undefined,
  };
}

function evaluateGateFailures(
  tickets: TaskTicket[],
  options: Required<Pick<TicketAutopilotOptions,
    'minCompletionRate' |
    'maxSupersededRate' |
    'maxBlockedTickets' |
    'maxAllowlistDenialRate'>>
): string[] {
  const failures: string[] = [];

  const terminalTickets = tickets.filter((ticket) => terminalStatuses.has(ticket.status));
  if (terminalTickets.length >= 10) {
    const completed = terminalTickets.filter((ticket) => ticket.status === 'completed').length;
    const superseded = terminalTickets.filter((ticket) => ticket.status === 'superseded').length;
    const completionRate = completed / Math.max(1, terminalTickets.length);
    const supersededRate = superseded / Math.max(1, terminalTickets.length);

    if (completionRate < options.minCompletionRate) {
      failures.push(`completion-rate-low:${completionRate.toFixed(3)}<${options.minCompletionRate}`);
    }

    if (supersededRate > options.maxSupersededRate) {
      failures.push(`superseded-rate-high:${supersededRate.toFixed(3)}>${options.maxSupersededRate}`);
    }
  }

  const blockedCount = tickets.filter((ticket) => ticket.status === 'blocked').length;
  if (blockedCount > options.maxBlockedTickets) {
    failures.push(`blocked-count-high:${blockedCount}>${options.maxBlockedTickets}`);
  }

  const erroredTickets = tickets.filter((ticket) => typeof ticket.error === 'string' && ticket.error.trim().length > 0);
  if (erroredTickets.length >= 5) {
    const allowlistDenials = erroredTickets.filter((ticket) => /allowlist|allowlisted/i.test(ticket.error ?? '')).length;
    const allowlistDenialRate = allowlistDenials / Math.max(1, erroredTickets.length);
    if (allowlistDenialRate > options.maxAllowlistDenialRate) {
      failures.push(`allowlist-denial-rate-high:${allowlistDenialRate.toFixed(3)}>${options.maxAllowlistDenialRate}`);
    }
  }

  return failures;
}

export async function runTicketAutopilot(
  dependencies: {
    repository: TicketAutopilotRepository;
    selfAuditSeeder?: TicketAutopilotSeeder | null;
  },
  options: TicketAutopilotOptions = {}
): Promise<TicketAutopilotResult> {
  const tickets = await dependencies.repository.listTickets('all');
  const waveSize = Math.max(1, Math.min(options.waveSize ?? 5, 10));
  const maxActiveTickets = Math.max(1, options.maxActiveTickets ?? 40);
  const gateFailures = evaluateGateFailures(tickets, {
    minCompletionRate: options.minCompletionRate ?? 0.7,
    maxSupersededRate: options.maxSupersededRate ?? 0.2,
    maxBlockedTickets: options.maxBlockedTickets ?? 5,
    maxAllowlistDenialRate: options.maxAllowlistDenialRate ?? 0.08,
  });
  const blockedByGates = gateFailures.length > 0;
  const runnableTicketCount = tickets.filter(isRunnableTicket).length;
  const awaitingApprovalCount = tickets.filter(isPendingOperatorApproval).length;
  const activeTicketCount = tickets.filter((ticket) => activeStatuses.has(ticket.status)).length;
  const queueCapacity = Math.max(0, maxActiveTickets - activeTicketCount);
  const availableWaveSlots = blockedByGates ? 0 : Math.min(waveSize, queueCapacity);
  const resumableTickets = tickets.filter(isApprovedAwaitingApproval);
  const retryAttemptLimit = options.maxAttempts ?? 3;
  const retryCandidates = tickets.filter(
    (ticket) => retryableStatuses.has(ticket.status) || (options.includeCancelled && ticket.status === 'cancelled')
  );
  const retryableTickets = retryCandidates.filter((ticket) => ticket.attemptCount < retryAttemptLimit);
  const skippedRetryCap = retryCandidates.filter((ticket) => ticket.attemptCount >= retryAttemptLimit);

  const resumed: TaskTicket[] = [];
  const requeued: TaskTicket[] = [];

  if (!blockedByGates && availableWaveSlots > 0) {
    const resumableLimit = Math.min(availableWaveSlots, resumableTickets.length);
    for (const ticket of resumableTickets.slice(0, resumableLimit)) {
      resumed.push(
        options.dryRun
          ? cloneAsPending(ticket)
          : await dependencies.repository.resumeApprovedTicket(ticket.id)
      );
    }

    const remainingSlots = Math.max(0, availableWaveSlots - resumed.length);
    for (const ticket of retryableTickets.slice(0, remainingSlots)) {
      requeued.push(
        options.dryRun ? cloneAsPending(ticket) : await dependencies.repository.retryTicket(ticket.id)
      );
    }
  }

  let selfAudit: SelfAuditSeedResult | null = null;
  const queueReady = runnableTicketCount > 0 || resumed.length > 0 || requeued.length > 0;

  if (
    !blockedByGates &&
    availableWaveSlots > 0 &&
    !queueReady &&
    awaitingApprovalCount === 0 &&
    options.seedSelfAuditWhenIdle !== false &&
    dependencies.selfAuditSeeder
  ) {
    selfAudit = await dependencies.selfAuditSeeder.seedTickets({
      limit: Math.min(options.selfAuditLimit ?? availableWaveSlots, availableWaveSlots),
      dryRun: options.dryRun,
    });
  }

  return {
    runnableTicketCount,
    awaitingApprovalCount,
    activeTicketCount,
    availableWaveSlots,
    resumed,
    requeued,
    skippedRetryCap,
    blockedByGates,
    gateFailures,
    selfAudit,
    queueReady: queueReady || (selfAudit?.created.length ?? 0) > 0,
  };
}
