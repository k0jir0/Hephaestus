import type { SelfAuditSeedOptions, SelfAuditSeedResult } from './self-audit.js';
import {
  planTicketAutopilotSchedule,
  resolveSelfAuditSeedLimit,
  shouldSeedSelfAuditFromAutopilot,
} from './domain/scheduling/ticket-autopilot-policy.js';
import type { TaskStatus, TaskTicket } from './types.js';

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
  disableRetryQuarantine?: boolean;
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
  minSourceGroundingCoverage?: number;
  minSourceEvidenceCoverage?: number;
  maxSourceDriftedTickets?: number;
  sourceGroundingSnapshot?: {
    timestamp?: string;
    groundingCoverage?: number;
    eventEvidence?: {
      auditableTickets?: number;
      eventEvidenceCoverage?: number;
      driftedTickets?: string[];
    };
  };
  enforceSourceSnapshot?: boolean;
  maxSourceSnapshotAgeHours?: number;
  additionalGateFailures?: string[];
}

export interface TicketAutopilotResult {
  runnableTicketCount: number;
  awaitingApprovalCount: number;
  activeTicketCount: number;
  availableWaveSlots: number;
  resumed: TaskTicket[];
  requeued: TaskTicket[];
  skippedRetryCap: TaskTicket[];
  quarantinedRetryTickets: TaskTicket[];
  blockedByGates: boolean;
  gateFailures: string[];
  selfAudit: SelfAuditSeedResult | null;
  queueReady: boolean;
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
  const schedule = planTicketAutopilotSchedule(tickets, options);
  const {
    runnableTicketCount,
    awaitingApprovalCount,
    activeTicketCount,
    availableWaveSlots,
    blockedByGates,
    gateFailures,
    resumableTickets,
    retryableTickets,
    quarantinedRetryTickets,
    skippedRetryCap,
  } = schedule;

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
  const selfAuditSeeder = dependencies.selfAuditSeeder ?? null;

  if (shouldSeedSelfAuditFromAutopilot({
    blockedByGates,
    availableWaveSlots,
    queueReady,
    awaitingApprovalCount,
    seedSelfAuditWhenIdle: options.seedSelfAuditWhenIdle,
    hasSelfAuditSeeder: selfAuditSeeder !== null,
  }) && selfAuditSeeder) {
    selfAudit = await selfAuditSeeder.seedTickets({
      limit: resolveSelfAuditSeedLimit(options.selfAuditLimit, availableWaveSlots),
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
    quarantinedRetryTickets,
    blockedByGates,
    gateFailures,
    selfAudit,
    queueReady: queueReady || (selfAudit?.created.length ?? 0) > 0,
  };
}
