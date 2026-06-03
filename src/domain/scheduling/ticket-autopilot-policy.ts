import type { TaskStatus, TaskTicket } from '../../types.js';
import {
  globalErrorBudgetExclusionPatterns,
  hardBlockFailurePatterns,
} from '../tickets/failure-policy.js';

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
const admittedStatuses = new Set<TaskStatus>([
  'pending',
  'in_progress',
  'planned',
  'applying',
  'verifying',
  'awaiting_approval',
]);
const terminalStatuses = new Set<TaskStatus>(['completed', 'superseded', 'cancelled']);

const recoveryFirstDescriptionPatterns: readonly RegExp[] = [
  /\bfix\b/i,
  /\bupdate\b/i,
  /\bbuild\b/i,
  /\brepair\b/i,
  /\brestore\b/i,
];

const staleRecoveryQuarantinePatterns: readonly RegExp[] = [
  /previous daemon exited before finishing/i,
  /stale[-\s]+recovery/i,
  /stale active ticket/i,
];

const unsupportedEnvelopeQuarantinePatterns: readonly RegExp[] = [
  /unsupported task envelope/i,
  /governed runtime does not yet bind/i,
  /tool call .* is not yet supported/i,
];

const retryQuarantineFailurePatterns: readonly RegExp[] = [
  ...hardBlockFailurePatterns,
  ...globalErrorBudgetExclusionPatterns,
  ...unsupportedEnvelopeQuarantinePatterns,
  ...staleRecoveryQuarantinePatterns,
];

export interface TicketAutopilotGateOptions {
  minCompletionRate?: number;
  maxSupersededRate?: number;
  maxBlockedTickets?: number;
  blockedWindowDays?: number;
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
  nowMs?: number;
}

interface ResolvedTicketAutopilotGateOptions {
  minCompletionRate: number;
  maxSupersededRate: number;
  maxBlockedTickets: number;
  blockedWindowDays?: number;
  maxAllowlistDenialRate: number;
  minSourceGroundingCoverage: number;
  minSourceEvidenceCoverage: number;
  maxSourceDriftedTickets: number;
  sourceGroundingSnapshot?: TicketAutopilotGateOptions['sourceGroundingSnapshot'];
  enforceSourceSnapshot: boolean;
  maxSourceSnapshotAgeHours: number;
  additionalGateFailures: string[];
  nowMs: number;
}

export interface TicketAutopilotSchedulingOptions extends TicketAutopilotGateOptions {
  includeCancelled?: boolean;
  disableRetryQuarantine?: boolean;
  maxAttempts?: number;
  waveSize?: number;
  maxActiveTickets?: number;
}

export interface TicketAutopilotSchedule {
  runnableTicketCount: number;
  awaitingApprovalCount: number;
  activeTicketCount: number;
  availableWaveSlots: number;
  blockedByGates: boolean;
  gateFailures: string[];
  resumableTickets: TaskTicket[];
  retryableTickets: TaskTicket[];
  quarantinedRetryTickets: TaskTicket[];
  skippedRetryCap: TaskTicket[];
}

export interface TicketAutopilotSelfAuditSeedInput {
  blockedByGates: boolean;
  availableWaveSlots: number;
  queueReady: boolean;
  awaitingApprovalCount: number;
  seedSelfAuditWhenIdle?: boolean;
  hasSelfAuditSeeder: boolean;
}

function resolveGateOptions(
  options: TicketAutopilotGateOptions
): ResolvedTicketAutopilotGateOptions {
  return {
    minCompletionRate: options.minCompletionRate ?? 0.7,
    maxSupersededRate: options.maxSupersededRate ?? 0.2,
    maxBlockedTickets: options.maxBlockedTickets ?? 5,
    blockedWindowDays:
      options.blockedWindowDays !== undefined ? Math.max(1, options.blockedWindowDays) : undefined,
    maxAllowlistDenialRate: options.maxAllowlistDenialRate ?? 0.08,
    minSourceGroundingCoverage: options.minSourceGroundingCoverage ?? 0.9,
    minSourceEvidenceCoverage: options.minSourceEvidenceCoverage ?? 0.95,
    maxSourceDriftedTickets: options.maxSourceDriftedTickets ?? 0,
    sourceGroundingSnapshot: options.sourceGroundingSnapshot,
    enforceSourceSnapshot: options.enforceSourceSnapshot ?? false,
    maxSourceSnapshotAgeHours: options.maxSourceSnapshotAgeHours ?? 24,
    additionalGateFailures: options.additionalGateFailures ?? [],
    nowMs: options.nowMs ?? Date.now(),
  };
}

export function normalizeTicketAutopilotWaveSize(candidate: number | undefined): number {
  return Math.max(1, Math.min(candidate ?? 5, 10));
}

export function normalizeTicketAutopilotMaxActiveTickets(candidate: number | undefined): number {
  return Math.max(1, candidate ?? 40);
}

export function resolveTicketAutopilotRetryAttemptLimit(candidate: number | undefined): number {
  return candidate ?? 3;
}

export function isRunnableTicket(ticket: TaskTicket): boolean {
  return runnableStatuses.has(ticket.status);
}

export function isApprovedAwaitingApproval(ticket: TaskTicket): boolean {
  return ticket.status === 'awaiting_approval' && ticket.approval?.status === 'approved';
}

export function isPendingOperatorApproval(ticket: TaskTicket): boolean {
  return ticket.status === 'awaiting_approval' && ticket.approval?.status !== 'approved';
}

export function getTicketAutopilotRetryQuarantineReason(ticket: TaskTicket): string | undefined {
  const reason = ticket.error?.trim();
  if (!reason) {
    return undefined;
  }

  if (unsupportedEnvelopeQuarantinePatterns.some((pattern) => pattern.test(reason))) {
    return 'unsupported-envelope';
  }

  if (staleRecoveryQuarantinePatterns.some((pattern) => pattern.test(reason))) {
    return 'stale-recovery';
  }

  if (/allowlist|allowlisted/i.test(reason)) {
    return 'allowlist-denial';
  }

  if (globalErrorBudgetExclusionPatterns.some((pattern) => pattern.test(reason))) {
    return 'plan-or-file-boundary';
  }

  if (retryQuarantineFailurePatterns.some((pattern) => pattern.test(reason))) {
    return 'policy-hard-block';
  }

  return undefined;
}

function hasRecoveryFirstDescription(ticket: TaskTicket): boolean {
  return recoveryFirstDescriptionPatterns.some((pattern) => pattern.test(ticket.description));
}

function compareRetryRecoveryPriority(left: TaskTicket, right: TaskTicket): number {
  const leftRecoveryFirst = hasRecoveryFirstDescription(left) ? 0 : 1;
  const rightRecoveryFirst = hasRecoveryFirstDescription(right) ? 0 : 1;
  if (leftRecoveryFirst !== rightRecoveryFirst) {
    return leftRecoveryFirst - rightRecoveryFirst;
  }

  if (left.attemptCount !== right.attemptCount) {
    return left.attemptCount - right.attemptCount;
  }

  if (left.sourceOrder !== right.sourceOrder) {
    return left.sourceOrder - right.sourceOrder;
  }

  return left.createdAt.getTime() - right.createdAt.getTime();
}

function isBlockedTicketWithinWindow(
  ticket: TaskTicket,
  blockedWindowDays: number | undefined,
  nowMs: number
): boolean {
  if (blockedWindowDays === undefined) {
    return true;
  }

  const referenceAt = ticket.blockedAt ?? ticket.updatedAt ?? ticket.createdAt;
  return nowMs - referenceAt.getTime() <= blockedWindowDays * 24 * 60 * 60 * 1000;
}

export function evaluateTicketAutopilotGateFailures(
  tickets: TaskTicket[],
  options: TicketAutopilotGateOptions = {}
): string[] {
  const resolvedOptions = resolveGateOptions(options);
  const failures: string[] = [...resolvedOptions.additionalGateFailures];

  const terminalTickets = tickets.filter((ticket) => terminalStatuses.has(ticket.status));
  if (terminalTickets.length >= 10) {
    const completed = terminalTickets.filter((ticket) => ticket.status === 'completed').length;
    const superseded = terminalTickets.filter((ticket) => ticket.status === 'superseded').length;
    const completionRate = completed / Math.max(1, terminalTickets.length);
    const supersededRate = superseded / Math.max(1, terminalTickets.length);

    if (completionRate < resolvedOptions.minCompletionRate) {
      failures.push(`completion-rate-low:${completionRate.toFixed(3)}<${resolvedOptions.minCompletionRate}`);
    }

    if (supersededRate > resolvedOptions.maxSupersededRate) {
      failures.push(`superseded-rate-high:${supersededRate.toFixed(3)}>${resolvedOptions.maxSupersededRate}`);
    }
  }

  const blockedCount = tickets.filter(
    (ticket) =>
      ticket.status === 'blocked' &&
      getTicketAutopilotRetryQuarantineReason(ticket) === undefined &&
      isBlockedTicketWithinWindow(ticket, resolvedOptions.blockedWindowDays, resolvedOptions.nowMs)
  ).length;
  if (blockedCount > resolvedOptions.maxBlockedTickets) {
    failures.push(`blocked-count-high:${blockedCount}>${resolvedOptions.maxBlockedTickets}`);
  }

  const erroredTickets = tickets.filter((ticket) => typeof ticket.error === 'string' && ticket.error.trim().length > 0);
  if (erroredTickets.length >= 5) {
    const allowlistDenials = erroredTickets.filter((ticket) => /allowlist|allowlisted/i.test(ticket.error ?? '')).length;
    const allowlistDenialRate = allowlistDenials / Math.max(1, erroredTickets.length);
    if (allowlistDenialRate > resolvedOptions.maxAllowlistDenialRate) {
      failures.push(`allowlist-denial-rate-high:${allowlistDenialRate.toFixed(3)}>${resolvedOptions.maxAllowlistDenialRate}`);
    }
  }

  if (resolvedOptions.enforceSourceSnapshot && !resolvedOptions.sourceGroundingSnapshot) {
    failures.push('source-grounding-snapshot-missing');
    return failures;
  }

  if (!resolvedOptions.sourceGroundingSnapshot) {
    return failures;
  }

  if (resolvedOptions.enforceSourceSnapshot) {
    const snapshotTimestamp = resolvedOptions.sourceGroundingSnapshot.timestamp;
    if (!snapshotTimestamp) {
      failures.push('source-grounding-snapshot-invalid');
      return failures;
    }

    const snapshotMs = Date.parse(snapshotTimestamp);
    if (!Number.isFinite(snapshotMs)) {
      failures.push('source-grounding-snapshot-invalid');
      return failures;
    }

    const snapshotAgeHours = (resolvedOptions.nowMs - snapshotMs) / (60 * 60 * 1000);
    if (snapshotAgeHours > resolvedOptions.maxSourceSnapshotAgeHours) {
      failures.push(
        `source-grounding-snapshot-stale:${snapshotAgeHours.toFixed(2)}h>${resolvedOptions.maxSourceSnapshotAgeHours}`
      );
    }
  }

  const sourceGroundingCoverage = Number(resolvedOptions.sourceGroundingSnapshot.groundingCoverage ?? 1);
  if (sourceGroundingCoverage < resolvedOptions.minSourceGroundingCoverage) {
    failures.push(
      `source-grounding-coverage-low:${sourceGroundingCoverage.toFixed(3)}<${resolvedOptions.minSourceGroundingCoverage}`
    );
  }

  const sourceEvidenceAuditableTickets = Number(
    resolvedOptions.sourceGroundingSnapshot.eventEvidence?.auditableTickets ?? 0
  );
  const sourceEvidenceCoverage = Number(
    resolvedOptions.sourceGroundingSnapshot.eventEvidence?.eventEvidenceCoverage ?? 1
  );
  const sourceDriftedTickets = resolvedOptions.sourceGroundingSnapshot.eventEvidence?.driftedTickets ?? [];

  if (sourceEvidenceAuditableTickets > 0 && sourceEvidenceCoverage < resolvedOptions.minSourceEvidenceCoverage) {
    failures.push(
      `source-evidence-coverage-low:${sourceEvidenceCoverage.toFixed(3)}<${resolvedOptions.minSourceEvidenceCoverage}`
    );
  }

  if (sourceDriftedTickets.length > resolvedOptions.maxSourceDriftedTickets) {
    failures.push(
      `source-evidence-drifted-high:${sourceDriftedTickets.length}>${resolvedOptions.maxSourceDriftedTickets}`
    );
  }

  return failures;
}

export function planTicketAutopilotSchedule(
  tickets: TaskTicket[],
  options: TicketAutopilotSchedulingOptions = {}
): TicketAutopilotSchedule {
  const waveSize = normalizeTicketAutopilotWaveSize(options.waveSize);
  const maxActiveTickets = normalizeTicketAutopilotMaxActiveTickets(options.maxActiveTickets);
  const gateFailures = evaluateTicketAutopilotGateFailures(tickets, options);
  const blockedByGates = gateFailures.length > 0;
  const runnableTicketCount = tickets.filter(isRunnableTicket).length;
  const awaitingApprovalCount = tickets.filter(isPendingOperatorApproval).length;
  const activeTicketCount = tickets.filter((ticket) => activeStatuses.has(ticket.status)).length;
  const admittedTicketCount = tickets.filter((ticket) => admittedStatuses.has(ticket.status)).length;
  const queueCapacity = Math.max(0, maxActiveTickets - admittedTicketCount);
  const availableWaveSlots = blockedByGates ? 0 : Math.min(waveSize, queueCapacity);
  const retryAttemptLimit = resolveTicketAutopilotRetryAttemptLimit(options.maxAttempts);
  const retryCandidates = tickets.filter(
    (ticket) => retryableStatuses.has(ticket.status) || (options.includeCancelled && ticket.status === 'cancelled')
  );
  const retryCandidatesUnderCap = retryCandidates.filter((ticket) => ticket.attemptCount < retryAttemptLimit);
  const quarantinedRetryTickets = options.disableRetryQuarantine
    ? []
    : retryCandidatesUnderCap.filter((ticket) => getTicketAutopilotRetryQuarantineReason(ticket) !== undefined);
  const quarantinedRetryTicketIds = new Set(quarantinedRetryTickets.map((ticket) => ticket.id));

  return {
    runnableTicketCount,
    awaitingApprovalCount,
    activeTicketCount,
    availableWaveSlots,
    blockedByGates,
    gateFailures,
    resumableTickets: tickets.filter(isApprovedAwaitingApproval),
    retryableTickets: retryCandidatesUnderCap
      .filter((ticket) => !quarantinedRetryTicketIds.has(ticket.id))
      .sort(compareRetryRecoveryPriority),
    quarantinedRetryTickets,
    skippedRetryCap: retryCandidates.filter((ticket) => ticket.attemptCount >= retryAttemptLimit),
  };
}

export function shouldSeedSelfAuditFromAutopilot(input: TicketAutopilotSelfAuditSeedInput): boolean {
  return (
    !input.blockedByGates &&
    input.availableWaveSlots > 0 &&
    !input.queueReady &&
    input.awaitingApprovalCount === 0 &&
    input.seedSelfAuditWhenIdle !== false &&
    input.hasSelfAuditSeeder
  );
}

export function resolveSelfAuditSeedLimit(candidate: number | undefined, availableWaveSlots: number): number {
  return Math.min(candidate ?? availableWaveSlots, availableWaveSlots);
}
