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
}

export interface TicketAutopilotResult {
  runnableTicketCount: number;
  awaitingApprovalCount: number;
  resumed: TaskTicket[];
  requeued: TaskTicket[];
  skippedRetryCap: TaskTicket[];
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

export async function runTicketAutopilot(
  dependencies: {
    repository: TicketAutopilotRepository;
    selfAuditSeeder?: TicketAutopilotSeeder | null;
  },
  options: TicketAutopilotOptions = {}
): Promise<TicketAutopilotResult> {
  const tickets = await dependencies.repository.listTickets('all');
  const runnableTicketCount = tickets.filter(isRunnableTicket).length;
  const awaitingApprovalCount = tickets.filter(isPendingOperatorApproval).length;
  const resumableTickets = tickets.filter(isApprovedAwaitingApproval);
  const retryAttemptLimit = options.maxAttempts ?? 3;
  const retryCandidates = tickets.filter(
    (ticket) => retryableStatuses.has(ticket.status) || (options.includeCancelled && ticket.status === 'cancelled')
  );
  const retryableTickets = retryCandidates.filter((ticket) => ticket.attemptCount < retryAttemptLimit);
  const skippedRetryCap = retryCandidates.filter((ticket) => ticket.attemptCount >= retryAttemptLimit);

  const resumed: TaskTicket[] = [];
  for (const ticket of resumableTickets) {
    resumed.push(
      options.dryRun
        ? cloneAsPending(ticket)
        : await dependencies.repository.resumeApprovedTicket(ticket.id)
    );
  }

  const requeued: TaskTicket[] = [];
  for (const ticket of retryableTickets) {
    requeued.push(
      options.dryRun ? cloneAsPending(ticket) : await dependencies.repository.retryTicket(ticket.id)
    );
  }

  let selfAudit: SelfAuditSeedResult | null = null;
  const queueReady = runnableTicketCount > 0 || resumed.length > 0 || requeued.length > 0;

  if (
    !queueReady &&
    awaitingApprovalCount === 0 &&
    options.seedSelfAuditWhenIdle !== false &&
    dependencies.selfAuditSeeder
  ) {
    selfAudit = await dependencies.selfAuditSeeder.seedTickets({
      limit: options.selfAuditLimit,
      dryRun: options.dryRun,
    });
  }

  return {
    runnableTicketCount,
    awaitingApprovalCount,
    resumed,
    requeued,
    skippedRetryCap,
    selfAudit,
    queueReady: queueReady || (selfAudit?.created.length ?? 0) > 0,
  };
}
