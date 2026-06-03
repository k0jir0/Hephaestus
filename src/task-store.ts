import fs from 'fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { config } from './config.js';
import { createComponentLogger } from './logger.js';
import type {
  PendingTaskSideEffect,
  PromotionRepository,
  TaskArtifactRepository,
  RepositoryReadinessProbe,
  TaskRepository,
  TaskSideEffectRepository,
  TaskWorkspaceBindingRepository,
  WorkerVersionRepository,
} from './repositories.js';
import { resolveTaskAttemptStatusTransition } from './domain/attempts/attempt-lifecycle.js';
import {
  assertValidPromotionTransition,
  resolvePromotionEvent,
  assertValidWorkerVersionTransition,
} from './domain/promotion/promotion-lifecycle.js';
import { resolveApprovedResumeEligibility } from './domain/tickets/approval-resume-policy.js';
import { extractSourceGroundingKeys } from './domain/policy/source-grounding-policy.js';
import { assertAmendedRetryDescription, assertRetryableTicketStatus } from './domain/tickets/retry-policy.js';
import { assertValidTaskTransition } from './domain/tickets/ticket-lifecycle.js';
import {
  formatTaskBoardTicketComment,
  normalizeTaskDescription,
  parseTaskBoard,
  renderTaskBoard,
} from './task-board.js';
import type {
  Task,
  TaskApprovalState,
  TaskAttempt,
  TaskAttemptStatus,
  TaskEvent,
  PromotionRecord,
  PromotionStatus,
  TaskSideEffect,
  TaskSideEffectStatus,
  TaskStatus,
  TaskTicket,
  ToolCall,
  WorkerVersion,
  WorkerVersionStatus,
} from './types.js';
import { TaskWatcher } from './watcher.js';

const logger = createComponentLogger('TaskStore');
const staleRecoverableStatuses = new Set<TaskStatus>([
  'in_progress',
  'planned',
  'applying',
  'verifying',
]);
const staleRecoveryReason =
  'Recovered stale active ticket after a previous daemon exited before finishing the attempt.';

type DatabaseSync = import('node:sqlite').DatabaseSync;

export interface TicketStoreRepositoryOptions {
  tasksFile?: string;
  storeFile?: string;
  forceMarkdownFallback?: boolean;
  allowMarkdownFallback?: boolean;
  importLegacyTaskBoardIfStoreEmpty?: boolean;
  projectionEnabled?: boolean;
  pollingIntervalMs?: number;
  redispatchPendingAfterMs?: number;
  redispatchPendingMaxAfterMs?: number;
  redispatchBackoffMultiplier?: number;
  projectionRetryDelayMs?: number;
  projectionRetryMaxDelayMs?: number;
  staleRecoveryMinAgeMs?: number;
  projectionWriter?: (tasksFile: string, content: string) => Promise<void>;
}

export interface ProjectionHealthStatus {
  healthy: boolean;
  lastError?: string;
  retryScheduled: boolean;
  nextRetryDelayMs?: number;
  consecutiveFailures: number;
}

export interface ProjectionDriftStatus {
  checked: boolean;
  drifted: boolean;
  reason?: string;
}

export interface TicketStoreRevisionStamp {
  value: string;
  ticketCount: number;
  latestTicketUpdateMs: number;
  eventCount: number;
  latestEventMs: number;
}

export interface RecentEventQuery {
  ticketId?: string;
  limit?: number;
}

export interface D2EventSpineSnapshot {
  legacyEventCount: number;
  domainEventCount: number;
  domainEventsWithLegacyLink: number;
  eventEvidenceCount: number;
  ticketsWithLegacyOnly: string[];
  ticketsWithDomainOnly: string[];
  ticketsWithCountMismatch: string[];
}

export interface D2ReplaySummary {
  ticketCount: number;
  totalEvents: number;
  correlationCoverage: number;
  replayHash: string;
}

interface TicketRow {
  id: string;
  description: string;
  description_key: string;
  status: TaskStatus;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
  blocked_at: string | null;
  cancelled_at: string | null;
  current_attempt_id: string | null;
  result: string | null;
  error: string | null;
  plan_json: string | null;
  tool_calls_json: string | null;
  approval_json: string | null;
  attempt_count: number;
  source_order: number;
}

interface TaskAttemptRow {
  id: string;
  ticket_id: string;
  attempt_number: number;
  status: TaskAttemptStatus;
  workspace_id: string | null;
  workspace_root: string | null;
  isolation_mode: 'shared-root' | 'isolated-workspace' | null;
  started_at: string;
  ended_at: string | null;
  result: string | null;
  error: string | null;
  plan_json: string | null;
  tool_calls_json: string | null;
  approval_json: string | null;
  artifacts_json: string | null;
}

interface TicketEventRow {
  ticket_id: string;
  event_type: TaskEvent['type'];
  details: string | null;
  evidence_json: string | null;
  correlation_id: string | null;
  created_at: string;
}

interface DomainEventRow {
  id: string;
  ticket_id: string;
  event_type: TaskEvent['type'];
  details: string | null;
  evidence_json: string | null;
  correlation_id: string | null;
  legacy_event_id: number | null;
  created_at: string;
}

interface EventEvidenceRow {
  domain_event_id: string;
  ticket_id: string;
  evidence_key: string;
  evidence_value_json: string;
  created_at: string;
}

interface TaskSideEffectRow {
  id: string;
  ticket_id: string;
  attempt_id: string | null;
  correlation_id: string | null;
  effect_type: TaskSideEffect['type'];
  payload_json: string;
  status: TaskSideEffectStatus;
  idempotency_key: string;
  created_at: string;
  processed_at: string | null;
  last_error: string | null;
}

interface WorkerVersionRow {
  id: string;
  attempt_id: string;
  workspace_id: string | null;
  workspace_root: string | null;
  patch_bundle_path: string | null;
  verification_summary: string | null;
  created_at: string;
  activated_at: string | null;
  status: WorkerVersionStatus;
}

interface PromotionRecordRow {
  id: string;
  worker_version_id: string;
  status: PromotionStatus;
  requested_at: string;
  updated_at: string;
  approved_by: string | null;
  approval_id: string | null;
  failure_reason: string | null;
  rollback_reason: string | null;
}

export class TicketStoreRepository
  implements
    TaskRepository,
    RepositoryReadinessProbe,
    TaskSideEffectRepository,
    TaskArtifactRepository,
    TaskWorkspaceBindingRepository,
    WorkerVersionRepository,
    PromotionRepository
{
  private readonly tasksFile: string;
  private readonly storeFile: string;
  private readonly fallbackWatcher: TaskWatcher;
  private readonly forceMarkdownFallback: boolean;
  private readonly allowMarkdownFallback: boolean;
  private readonly importLegacyTaskBoardIfStoreEmpty: boolean;
  private readonly projectionEnabled: boolean;
  private readonly pollingIntervalMs: number;
  private readonly redispatchPendingAfterMs: number;
  private readonly redispatchPendingMaxAfterMs: number;
  private readonly redispatchBackoffMultiplier: number;
  private readonly projectionRetryDelayMs: number;
  private readonly projectionRetryMaxDelayMs: number;
  private readonly staleRecoveryMinAgeMs: number;
  private readonly projectionWriter: (tasksFile: string, content: string) => Promise<void>;
  private readonly knownPendingTaskIds = new Set<string>();
  private readonly pendingRedispatchAfter = new Map<string, number>();
  private readonly pendingRedispatchDelayMs = new Map<string, number>();
  private readonly pendingDispatchInFlight = new Set<string>();
  private pendingPollTimer: NodeJS.Timeout | null = null;
  private projectionRetryTimer: NodeJS.Timeout | null = null;
  private projectionFlushTimer: NodeJS.Timeout | null = null;
  private projectionScheduledRetryDelayMs: number | null = null;
  private projectionLastError: string | null = null;
  private projectionConsecutiveFailures = 0;
  private projectionNextRetryDelayMs = 0;
  private projectionWriteInProgress = false;
  private projectionWriteQueued = false;
  private lastProjectionWriteAtMs = 0;
  private readonly projectionMinWriteIntervalMs: number;
  private onNewTask: ((task: Task) => Promise<void>) | null = null;
  private db: DatabaseSync | null = null;
  private initialization: Promise<void> | null = null;
  private usingFallback = false;
  private dispatchInProgress = false;
  private currentPollIntervalMs: number;

  constructor(options: TicketStoreRepositoryOptions = {}) {
    this.tasksFile = options.tasksFile ?? config.tasksFile;
    this.storeFile = options.storeFile ?? config.ticketStoreFile;
    this.forceMarkdownFallback = options.forceMarkdownFallback ?? false;
    this.allowMarkdownFallback = options.allowMarkdownFallback ?? false;
    this.importLegacyTaskBoardIfStoreEmpty =
      options.importLegacyTaskBoardIfStoreEmpty ?? true;
    this.projectionEnabled = options.projectionEnabled ?? true;
    this.pollingIntervalMs =
      options.pollingIntervalMs !== undefined
        ? Math.max(1, options.pollingIntervalMs)
        : Math.max(100, Number.parseInt(process.env.TICKET_POLLING_INTERVAL_MS ?? '500', 10));
    this.redispatchPendingAfterMs =
      options.redispatchPendingAfterMs !== undefined
        ? Math.max(1, options.redispatchPendingAfterMs)
        : Math.max(1_000, Number.parseInt(process.env.REDISPATCH_PENDING_AFTER_MS ?? '15000', 10));
    this.redispatchPendingMaxAfterMs = Math.max(
      this.redispatchPendingAfterMs,
      options.redispatchPendingMaxAfterMs !== undefined
        ? Math.max(1, options.redispatchPendingMaxAfterMs)
        : Number.parseInt(process.env.REDISPATCH_PENDING_MAX_AFTER_MS ?? '120000', 10)
    );
    this.redispatchBackoffMultiplier = Math.max(
      1,
      options.redispatchBackoffMultiplier ?? Number.parseFloat(process.env.REDISPATCH_BACKOFF_MULTIPLIER ?? '1.5')
    );
    this.projectionRetryDelayMs = options.projectionRetryDelayMs ?? 1_000;
    this.projectionRetryMaxDelayMs = options.projectionRetryMaxDelayMs ?? 30_000;
    this.staleRecoveryMinAgeMs = Math.max(
      0,
      options.staleRecoveryMinAgeMs ?? Number.parseInt(process.env.STALE_RECOVERY_MIN_AGE_MS ?? '60000', 10)
    );
    this.projectionMinWriteIntervalMs = Math.max(
      0,
      Number.parseInt(process.env.PROJECTION_MIN_WRITE_INTERVAL_MS ?? '0', 10)
    );
    this.projectionWriter = options.projectionWriter ?? ((tasksFile, content) =>
      fs.writeFile(tasksFile, content, 'utf-8')
    );
    this.projectionNextRetryDelayMs = this.projectionRetryDelayMs;
    this.currentPollIntervalMs = this.pollingIntervalMs;
    this.fallbackWatcher = new TaskWatcher(this.tasksFile);
  }

  async start(callback: (task: Task) => Promise<void> | void): Promise<void> {
    await this.ensureInitialized();

    if (this.usingFallback) {
      return this.fallbackWatcher.start(callback);
    }

    this.onNewTask = async (task: Task) => {
      await callback(task);
    };

    await this.dispatchPendingTasks();
    this.schedulePendingDispatch(this.pollingIntervalMs);
  }

  async stop(): Promise<void> {
    if (this.pendingPollTimer) {
      clearTimeout(this.pendingPollTimer);
      this.pendingPollTimer = null;
    }

    if (this.projectionRetryTimer) {
      clearTimeout(this.projectionRetryTimer);
      this.projectionRetryTimer = null;
      this.projectionScheduledRetryDelayMs = null;
    }

    if (this.projectionFlushTimer) {
      clearTimeout(this.projectionFlushTimer);
      this.projectionFlushTimer = null;
    }

    if (this.usingFallback) {
      await this.fallbackWatcher.stop();
      return;
    }

    if (this.db) {
      this.db.close();
      this.db = null;
      this.initialization = null;
    }

    this.knownPendingTaskIds.clear();
    this.pendingRedispatchAfter.clear();
    this.pendingRedispatchDelayMs.clear();
    this.pendingDispatchInFlight.clear();
    this.onNewTask = null;
  }

  async getPendingTasks(): Promise<Task[]> {
    await this.ensureInitialized();

    if (this.usingFallback) {
      return this.fallbackWatcher.getPendingTasks();
    }

    const tasks = this.listTasksByStatus('pending');
    this.knownPendingTaskIds.clear();
    for (const task of tasks) {
      this.knownPendingTaskIds.add(task.id);
    }
    return tasks;
  }

  async markTaskInProgress(task: Task): Promise<void> {
    await this.ensureInitialized();

    if (this.usingFallback) {
      await this.fallbackWatcher.markTaskInProgress(task);
      return;
    }

    const ticket = this.findTicketForTask(task);
    if (!ticket) {
      logger.warn('Could not find ticket to mark in progress', { task: task.description });
      return;
    }

    assertValidTaskTransition(ticket.status, 'in_progress', `ticket ${ticket.id}`);

    const now = new Date().toISOString();
    const recoveredAttemptIds = this.closeOpenAttemptsForTicket(
      ticket.id,
      now,
      'stale',
      'Recovered orphaned active attempt before starting a new attempt.'
    );
    if (ticket.current_attempt_id || recoveredAttemptIds.length > 0) {
      this.recordEvent({
        ticketId: ticket.id,
        type: 'stale-recovered',
        createdAt: new Date(now),
        details: 'Cleared stale active attempt metadata before claiming the ticket.',
      });
    }

    const attemptNumber = this.getNextAttemptNumber(ticket.id);
    const attemptId = this.generateAttemptId();
    this.insertAttempt({
      id: attemptId,
      ticketId: ticket.id,
      attemptNumber,
      status: 'in_progress',
      startedAt: now,
    });

    this.getDatabase()
      .prepare(
        `update tickets
         set status = 'in_progress',
             updated_at = ?,
             started_at = coalesce(started_at, ?),
             attempt_count = ?,
             current_attempt_id = ?,
             error = null
         where id = ?`
      )
      .run(now, now, attemptNumber, attemptId, ticket.id);
    this.recordEvent({
      ticketId: ticket.id,
      type: 'claimed',
      createdAt: new Date(now),
      details: `${task.description} (${attemptId})`,
    });
    this.recordEvent({
      ticketId: ticket.id,
      type: 'attempt-started',
      createdAt: new Date(now),
      details: attemptId,
    });

    await this.writeProjectionSafely();
  }

  async markTaskAwaitingApproval(task: Task): Promise<void> {
    await this.ensureInitialized();

    if (this.usingFallback) {
      throw new Error('Approval checkpoints are unavailable in markdown fallback mode.');
    }

    const ticket = this.findTicketForTask(task);
    if (!ticket) {
      logger.warn('Could not find ticket to mark awaiting approval', { task: task.description });
      return;
    }

    assertValidTaskTransition(ticket.status, 'awaiting_approval', `ticket ${ticket.id}`);

    const now = new Date().toISOString();
    this.finishCurrentAttempt(ticket, {
      status: 'awaiting_approval',
      endedAt: now,
      error: task.error,
      planJson: task.plan ? JSON.stringify(task.plan) : undefined,
      toolCallsJson: serializeToolCalls(task.toolCalls),
      approvalJson: serializeApprovalState(task.approval),
    });

    this.getDatabase()
      .prepare(
        `update tickets
         set status = 'awaiting_approval',
             updated_at = ?,
             error = ?,
             plan_json = ?,
             tool_calls_json = coalesce(?, tool_calls_json),
             approval_json = coalesce(?, approval_json),
             current_attempt_id = null
         where id = ?`
      )
      .run(
        now,
        task.error ?? null,
        task.plan ? JSON.stringify(task.plan) : null,
        serializeToolCalls(task.toolCalls),
        serializeApprovalState(task.approval),
        ticket.id
      );
    this.recordEvent({
      ticketId: ticket.id,
      type: 'approval-requested',
      createdAt: new Date(now),
      details: task.error,
    });
    this.recordEvent({
      ticketId: ticket.id,
      type: 'attempt-finished',
      createdAt: new Date(now),
      details: ticket.current_attempt_id ?? undefined,
    });

    await this.writeProjectionSafely();
  }

  async markTaskCompleted(task: Task): Promise<void> {
    await this.ensureInitialized();

    if (this.usingFallback) {
      await this.fallbackWatcher.markTaskCompleted(task);
      return;
    }

    const ticket = this.findTicketForTask(task);
    if (!ticket) {
      logger.warn('Could not find ticket to mark completed', { task: task.description });
      return;
    }

    assertValidTaskTransition(ticket.status, 'completed', `ticket ${ticket.id}`);

    const now = new Date().toISOString();
    this.finishCurrentAttempt(ticket, {
      status: 'completed',
      endedAt: now,
      result: task.result,
      planJson: task.plan ? JSON.stringify(task.plan) : undefined,
      toolCallsJson: serializeToolCalls(task.toolCalls),
      approvalJson: serializeApprovalState(task.approval),
    });

    this.getDatabase()
      .prepare(
        `update tickets
         set status = 'completed',
             updated_at = ?,
             completed_at = ?,
             result = ?,
             error = null,
             plan_json = ?,
             tool_calls_json = coalesce(?, tool_calls_json),
             approval_json = coalesce(?, approval_json),
             current_attempt_id = null
         where id = ?`
      )
      .run(
        now,
        now,
        task.result ?? null,
        task.plan ? JSON.stringify(task.plan) : null,
        serializeToolCalls(task.toolCalls),
        serializeApprovalState(task.approval),
        ticket.id
      );
    this.recordEvent({
      ticketId: ticket.id,
      type: 'completed',
      createdAt: new Date(now),
      details: task.result,
    });
    this.recordEvent({
      ticketId: ticket.id,
      type: 'attempt-finished',
      createdAt: new Date(now),
      details: ticket.current_attempt_id ?? undefined,
    });

    await this.writeProjectionSafely();
  }

  async markTaskBlocked(task: Task): Promise<void> {
    await this.ensureInitialized();

    if (this.usingFallback) {
      await this.fallbackWatcher.markTaskBlocked(task);
      return;
    }

    const ticket = this.findTicketForTask(task);
    if (!ticket) {
      logger.warn('Could not find ticket to mark blocked', { task: task.description });
      return;
    }

    assertValidTaskTransition(ticket.status, 'blocked', `ticket ${ticket.id}`);

    const now = new Date().toISOString();
    this.finishCurrentAttempt(ticket, {
      status: 'blocked',
      endedAt: now,
      error: task.error,
      planJson: task.plan ? JSON.stringify(task.plan) : undefined,
      toolCallsJson: serializeToolCalls(task.toolCalls),
      approvalJson: serializeApprovalState(task.approval),
    });

    this.getDatabase()
      .prepare(
        `update tickets
         set status = 'blocked',
             updated_at = ?,
             blocked_at = ?,
             error = ?,
             plan_json = ?,
             tool_calls_json = coalesce(?, tool_calls_json),
             approval_json = coalesce(?, approval_json),
             current_attempt_id = null
         where id = ?`
      )
      .run(
        now,
        now,
        task.error ?? null,
        task.plan ? JSON.stringify(task.plan) : null,
        serializeToolCalls(task.toolCalls),
        serializeApprovalState(task.approval),
        ticket.id
      );
    this.recordEvent({
      ticketId: ticket.id,
      type: 'blocked',
      createdAt: new Date(now),
      details: task.error,
    });
    this.recordEvent({
      ticketId: ticket.id,
      type: 'attempt-finished',
      createdAt: new Date(now),
      details: ticket.current_attempt_id ?? undefined,
    });

    await this.writeProjectionSafely();
  }

  async markTaskFailed(task: Task): Promise<void> {
    await this.ensureInitialized();

    if (this.usingFallback) {
      await this.fallbackWatcher.markTaskFailed(task);
      return;
    }

    const ticket = this.findTicketForTask(task);
    if (!ticket) {
      logger.warn('Could not find ticket to mark failed', { task: task.description });
      return;
    }

    assertValidTaskTransition(ticket.status, 'failed', `ticket ${ticket.id}`);

    const now = new Date().toISOString();
    this.finishCurrentAttempt(ticket, {
      status: 'failed',
      endedAt: now,
      error: task.error,
      planJson: task.plan ? JSON.stringify(task.plan) : undefined,
      toolCallsJson: serializeToolCalls(task.toolCalls),
      approvalJson: serializeApprovalState(task.approval),
    });

    this.getDatabase()
      .prepare(
        `update tickets
         set status = 'failed',
             updated_at = ?,
             error = ?,
             plan_json = ?,
             tool_calls_json = coalesce(?, tool_calls_json),
             approval_json = coalesce(?, approval_json),
             current_attempt_id = null
         where id = ?`
      )
      .run(
        now,
        task.error ?? null,
        task.plan ? JSON.stringify(task.plan) : null,
        serializeToolCalls(task.toolCalls),
        serializeApprovalState(task.approval),
        ticket.id
      );
    this.recordEvent({
      ticketId: ticket.id,
      type: 'failed',
      createdAt: new Date(now),
      details: task.error,
    });
    this.recordEvent({
      ticketId: ticket.id,
      type: 'attempt-finished',
      createdAt: new Date(now),
      details: ticket.current_attempt_id ?? undefined,
    });

    await this.writeProjectionSafely();
  }

  async createTicket(
    description: string,
    options: { status?: TaskStatus } = {}
  ): Promise<TaskTicket> {
    await this.ensureInitialized();

    if (this.usingFallback) {
      throw new Error(
        'Ticket creation is unavailable in markdown fallback mode. Edit TASKS.md manually or enable SQLite.'
      );
    }

    const normalizedDescription = normalizeTaskDescription(description);
    if (!normalizedDescription) {
      throw new Error('Ticket description must be a non-empty string.');
    }

    const ticketId = this.generateTicketId();
    this.insertTicket({
      id: ticketId,
      description: normalizedDescription,
      status: options.status ?? 'pending',
      sourceOrder: this.getNextSourceOrder(),
    });
    await this.writeProjectionSafely();

    const ticket = await this.getTicket(ticketId);
    if (!ticket) {
      throw new Error(`Created ticket ${ticketId} could not be loaded.`);
    }

    return ticket;
  }

  async listTickets(status: TaskStatus | 'all' = 'all'): Promise<TaskTicket[]> {
    await this.ensureInitialized();

    if (this.usingFallback) {
      const tasks = await this.fallbackWatcher.getPendingTasks();
      return tasks.map((task, index) => ({
        ...task,
        updatedAt: task.createdAt,
        attemptCount: 0,
        sourceOrder: index + 1,
      }));
    }

    return status === 'all' ? this.listAllTasks() : this.listTasksByStatus(status);
  }

  async getTicketCounts(): Promise<Record<string, number>> {
    await this.ensureInitialized();

    if (this.usingFallback) {
      const tickets = await this.listTickets('all');
      return buildTicketCounts(tickets);
    }

    const rows = this.getDatabase()
      .prepare('select status, count(*) as count from tickets group by status')
      .all() as unknown as Array<{ status: TaskStatus; count: number }>;

    const counts: Record<string, number> = { total: 0 };
    for (const row of rows) {
      counts[row.status] = row.count;
      counts.total += row.count;
    }

    return counts;
  }

  async getTicket(ticketId: string): Promise<TaskTicket | null> {
    await this.ensureInitialized();

    if (this.usingFallback) {
      const tasks = await this.fallbackWatcher.getPendingTasks();
      const task = tasks.find((candidate) => candidate.id === ticketId);
      return task
        ? {
            ...task,
            updatedAt: task.createdAt,
            attemptCount: 0,
            sourceOrder: 1,
          }
        : null;
    }

    const row = this.getDatabase()
      .prepare('select * from tickets where id = ?')
      .get(ticketId) as TicketRow | undefined;
    return row ? this.mapRowToTask(row) : null;
  }

  async listEvents(ticketId?: string): Promise<TaskEvent[]> {
    await this.ensureInitialized();

    if (this.usingFallback) {
      return [];
    }

    const canonicalRows = (
      ticketId
        ? this.getDatabase()
            .prepare(
              `select id, ticket_id, event_type, details, evidence_json, correlation_id, legacy_event_id, created_at
               from domain_events
               where ticket_id = ?
               order by created_at asc, legacy_event_id asc, id asc`
            )
            .all(ticketId)
        : this.getDatabase()
            .prepare(
              `select id, ticket_id, event_type, details, evidence_json, correlation_id, legacy_event_id, created_at
               from domain_events
               order by created_at asc, legacy_event_id asc, id asc`
            )
            .all()
    ) as unknown as DomainEventRow[];

    if (canonicalRows.length > 0) {
      return canonicalRows.map((row) => this.mapDomainEventRow(row));
    }

    const legacyRows = (
      ticketId
        ? this.getDatabase()
            .prepare(
              `select ticket_id, event_type, details, evidence_json, correlation_id, created_at
               from ticket_events
               where ticket_id = ?
               order by created_at asc, id asc`
            )
            .all(ticketId)
        : this.getDatabase()
            .prepare(
              `select ticket_id, event_type, details, evidence_json, correlation_id, created_at
               from ticket_events
               order by created_at asc, id asc`
            )
            .all()
    ) as unknown as TicketEventRow[];

              return legacyRows.map((row) => this.mapEventRow(row));
  }

  async listRecentEvents(options: RecentEventQuery = {}): Promise<TaskEvent[]> {
    await this.ensureInitialized();

    if (this.usingFallback) {
      return [];
    }

    const limit = clampPositiveInteger(options.limit ?? 50, 1, 1000);
    const canonicalRows = (
      options.ticketId
        ? this.getDatabase()
            .prepare(
              `select id, ticket_id, event_type, details, evidence_json, correlation_id, legacy_event_id, created_at
               from domain_events
               where ticket_id = ?
               order by created_at desc, id desc
               limit ?`
            )
            .all(options.ticketId, limit)
        : this.getDatabase()
            .prepare(
              `select id, ticket_id, event_type, details, evidence_json, correlation_id, legacy_event_id, created_at
               from domain_events
               order by created_at desc, id desc
               limit ?`
            )
            .all(limit)
    ) as unknown as DomainEventRow[];

    if (canonicalRows.length > 0) {
      return canonicalRows.map((row) => this.mapDomainEventRow(row));
    }

    const legacyRows = (
      options.ticketId
        ? this.getDatabase()
            .prepare(
              `select ticket_id, event_type, details, evidence_json, correlation_id, created_at
               from ticket_events
               where ticket_id = ?
               order by created_at desc, id desc
               limit ?`
            )
            .all(options.ticketId, limit)
        : this.getDatabase()
            .prepare(
              `select ticket_id, event_type, details, evidence_json, correlation_id, created_at
               from ticket_events
               order by created_at desc, id desc
               limit ?`
            )
            .all(limit)
    ) as unknown as TicketEventRow[];

              return legacyRows.map((row) => this.mapEventRow(row));
  }

  async getLatestEventTimestamp(eventType?: TaskEvent['type']): Promise<Date | undefined> {
    await this.ensureInitialized();

    if (this.usingFallback) {
      return undefined;
    }

    const canonicalRow = (
      eventType
        ? this.getDatabase()
            .prepare('select max(created_at) as latest_created_at from domain_events where event_type = ?')
            .get(eventType)
        : this.getDatabase()
            .prepare('select max(created_at) as latest_created_at from domain_events')
            .get()
    ) as { latest_created_at: string | null } | undefined;

    if (canonicalRow?.latest_created_at) {
      return new Date(canonicalRow.latest_created_at);
    }

    const legacyRow = (
      eventType
        ? this.getDatabase()
            .prepare('select max(created_at) as latest_created_at from ticket_events where event_type = ?')
            .get(eventType)
        : this.getDatabase()
            .prepare('select max(created_at) as latest_created_at from ticket_events')
            .get()
    ) as { latest_created_at: string | null } | undefined;

    return legacyRow?.latest_created_at ? new Date(legacyRow.latest_created_at) : undefined;
  }

  async getD2EventSpineSnapshot(): Promise<D2EventSpineSnapshot> {
    await this.ensureInitialized();

    if (this.usingFallback) {
      return {
        legacyEventCount: 0,
        domainEventCount: 0,
        domainEventsWithLegacyLink: 0,
        eventEvidenceCount: 0,
        ticketsWithLegacyOnly: [],
        ticketsWithDomainOnly: [],
        ticketsWithCountMismatch: [],
      };
    }

    const db = this.getDatabase();
    const legacyEventCount = Number(
      (db.prepare('select count(*) as count from ticket_events').get() as { count: number }).count
    );
    const domainEventCount = Number(
      (db.prepare('select count(*) as count from domain_events').get() as { count: number }).count
    );
    const domainEventsWithLegacyLink = Number(
      (
        db
          .prepare('select count(*) as count from domain_events where legacy_event_id is not null')
          .get() as { count: number }
      ).count
    );
    const eventEvidenceCount = Number(
      (db.prepare('select count(*) as count from event_evidence').get() as { count: number }).count
    );

    const legacyCounts = db
      .prepare('select ticket_id, count(*) as count from ticket_events group by ticket_id')
      .all() as Array<{ ticket_id: string; count: number }>;
    const domainCounts = db
      .prepare('select ticket_id, count(*) as count from domain_events group by ticket_id')
      .all() as Array<{ ticket_id: string; count: number }>;

    const legacyByTicket = new Map(legacyCounts.map((row) => [row.ticket_id, Number(row.count)]));
    const domainByTicket = new Map(domainCounts.map((row) => [row.ticket_id, Number(row.count)]));

    const ticketsWithLegacyOnly = [...legacyByTicket.keys()]
      .filter((ticketId) => !domainByTicket.has(ticketId))
      .sort();
    const ticketsWithDomainOnly = [...domainByTicket.keys()]
      .filter((ticketId) => !legacyByTicket.has(ticketId))
      .sort();

    const ticketsWithCountMismatch = [...legacyByTicket.keys()]
      .filter((ticketId) => domainByTicket.has(ticketId))
      .filter((ticketId) => legacyByTicket.get(ticketId) !== domainByTicket.get(ticketId))
      .sort();

    return {
      legacyEventCount,
      domainEventCount,
      domainEventsWithLegacyLink,
      eventEvidenceCount,
      ticketsWithLegacyOnly,
      ticketsWithDomainOnly,
      ticketsWithCountMismatch,
    };
  }

  async getD2ReplaySummary(): Promise<D2ReplaySummary> {
    await this.ensureInitialized();

    if (this.usingFallback) {
      return {
        ticketCount: 0,
        totalEvents: 0,
        correlationCoverage: 1,
        replayHash: createHash('sha256').update('[]').digest('hex'),
      };
    }

    const rows = this.getDatabase()
      .prepare(
        `select ticket_id, event_type, details, evidence_json, correlation_id, created_at
         from domain_events
         order by ticket_id asc, created_at asc, id asc`
      )
      .all() as unknown as Array<{
      ticket_id: string;
      event_type: TaskEvent['type'];
      details: string | null;
      evidence_json: string | null;
      correlation_id: string | null;
      created_at: string;
    }>;

    if (rows.length === 0) {
      return {
        ticketCount: 0,
        totalEvents: 0,
        correlationCoverage: 1,
        replayHash: createHash('sha256').update('[]').digest('hex'),
      };
    }

    const perTicket = new Map<
      string,
      {
        eventCount: number;
        firstCreatedAt: string;
        lastCreatedAt: string;
        correlationEventCount: number;
        eventTypes: Record<string, number>;
      }
    >();

    let correlationEventCount = 0;
    for (const row of rows) {
      let entry = perTicket.get(row.ticket_id);
      if (!entry) {
        entry = {
          eventCount: 0,
          firstCreatedAt: row.created_at,
          lastCreatedAt: row.created_at,
          correlationEventCount: 0,
          eventTypes: {},
        };
        perTicket.set(row.ticket_id, entry);
      }

      entry.eventCount += 1;
      if (row.created_at < entry.firstCreatedAt) {
        entry.firstCreatedAt = row.created_at;
      }
      if (row.created_at > entry.lastCreatedAt) {
        entry.lastCreatedAt = row.created_at;
      }

      const eventTypeKey = row.event_type;
      entry.eventTypes[eventTypeKey] = (entry.eventTypes[eventTypeKey] ?? 0) + 1;

      if (row.correlation_id && row.correlation_id.trim().length > 0) {
        entry.correlationEventCount += 1;
        correlationEventCount += 1;
      }
    }

    const replayView = [...perTicket.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([ticketId, entry]) => ({
        ticketId,
        eventCount: entry.eventCount,
        firstCreatedAt: entry.firstCreatedAt,
        lastCreatedAt: entry.lastCreatedAt,
        correlationEventCount: entry.correlationEventCount,
        eventTypes: Object.entries(entry.eventTypes)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([type, count]) => ({ type, count })),
      }));

    const replayHash = createHash('sha256').update(JSON.stringify(replayView)).digest('hex');

    return {
      ticketCount: replayView.length,
      totalEvents: rows.length,
      correlationCoverage: Number((correlationEventCount / rows.length).toFixed(6)),
      replayHash,
    };
  }

  async retryTicket(
    ticketId: string,
    options: { amendedDescription?: string } = {}
  ): Promise<TaskTicket> {
    await this.ensureInitialized();

    if (this.usingFallback) {
      throw new Error(
        'Ticket retry is unavailable in markdown fallback mode. Edit TASKS.md manually or enable SQLite.'
      );
    }

    const ticket = await this.getTicket(ticketId);
    if (!ticket) {
      throw new Error(`Ticket not found: ${ticketId}`);
    }

    assertRetryableTicketStatus(ticket.status, `ticket ${ticket.id}`);

    assertValidTaskTransition(ticket.status, 'pending', `ticket ${ticket.id}`);

    const now = new Date().toISOString();
    const amendedDescription = options.amendedDescription === undefined
      ? undefined
      : normalizeTaskDescription(options.amendedDescription);
    assertAmendedRetryDescription(amendedDescription, 'Amended retry description');
    const sourceGroundingKeysBefore = extractSourceGroundingKeys(ticket.description);
    const effectiveDescription = amendedDescription ?? ticket.description;
    const sourceGroundingKeysAfter = extractSourceGroundingKeys(effectiveDescription);

    this.getDatabase()
      .prepare(
        `update tickets
         set status = 'pending',
             description = coalesce(?, description),
             description_key = coalesce(?, description_key),
             updated_at = ?,
             blocked_at = null,
             cancelled_at = null,
             error = null,
             current_attempt_id = null,
             plan_json = null,
             tool_calls_json = null,
             approval_json = null,
             source_order = ?
         where id = ?`
      )
      .run(
        amendedDescription ?? null,
        amendedDescription ? createDescriptionKey(amendedDescription) : null,
        now,
        this.getNextSourceOrder(),
        ticketId
      );

    if (amendedDescription && amendedDescription !== ticket.description) {
      this.recordEvent({
        ticketId,
        type: 'amended',
        createdAt: new Date(now),
        details: `Retry amended from "${ticket.description}" to "${amendedDescription}".`,
        evidence: {
          sourceGroundingKeysBefore,
          sourceGroundingKeysAfter,
        },
      });
    }

    this.recordEvent({
      ticketId,
      type: 'requeued',
      createdAt: new Date(now),
      details: amendedDescription
        ? 'Retry requested with an amended task description.'
        : 'Retry requested through the operator interface.',
      evidence: {
        sourceGroundingKeys: sourceGroundingKeysAfter,
        sourceGroundingCount: sourceGroundingKeysAfter.length,
      },
    });

    await this.writeProjectionSafely();

    const updatedTicket = await this.getTicket(ticketId);
    if (!updatedTicket) {
      throw new Error(`Retried ticket ${ticketId} could not be loaded.`);
    }

    return updatedTicket;
  }

  async cancelTicket(ticketId: string, reason = 'Cancelled by operator.'): Promise<TaskTicket> {
    await this.ensureInitialized();

    if (this.usingFallback) {
      throw new Error(
        'Ticket cancellation is unavailable in markdown fallback mode. Edit TASKS.md manually or enable SQLite.'
      );
    }

    const ticket = await this.getTicket(ticketId);
    if (!ticket) {
      throw new Error(`Ticket not found: ${ticketId}`);
    }

    const now = new Date().toISOString();
    const row = this.findTicketForTask(ticket);
    if (row) {
      assertValidTaskTransition(row.status, 'cancelled', `ticket ${row.id}`);
      this.finishCurrentAttempt(row, {
        status: 'cancelled',
        endedAt: now,
        error: reason,
      });
    }

    this.getDatabase()
      .prepare(
        `update tickets
         set status = 'cancelled',
             updated_at = ?,
             cancelled_at = ?,
             error = ?,
             current_attempt_id = null
         where id = ?`
      )
      .run(now, now, reason, ticketId);

    this.recordEvent({
      ticketId,
      type: 'cancelled',
      createdAt: new Date(now),
      details: reason,
    });

    await this.writeProjectionSafely();

    const updatedTicket = await this.getTicket(ticketId);
    if (!updatedTicket) {
      throw new Error(`Cancelled ticket ${ticketId} could not be loaded.`);
    }

    return updatedTicket;
  }

  async supersedeTicket(ticketId: string, reason = 'Superseded by newer work.'): Promise<TaskTicket> {
    await this.ensureInitialized();

    if (this.usingFallback) {
      throw new Error(
        'Ticket supersession is unavailable in markdown fallback mode. Edit TASKS.md manually or enable SQLite.'
      );
    }

    const ticket = await this.getTicket(ticketId);
    if (!ticket) {
      throw new Error(`Ticket not found: ${ticketId}`);
    }

    const now = new Date().toISOString();
    const row = this.findTicketForTask(ticket);
    if (row) {
      assertValidTaskTransition(row.status, 'superseded', `ticket ${row.id}`);
      this.finishCurrentAttempt(row, {
        status: 'cancelled',
        endedAt: now,
        error: reason,
      });
    }

    this.getDatabase()
      .prepare(
        `update tickets
         set status = 'superseded',
             updated_at = ?,
             cancelled_at = ?,
             error = ?,
             current_attempt_id = null
         where id = ?`
      )
      .run(now, now, reason, ticketId);

    this.recordEvent({
      ticketId,
      type: 'superseded',
      createdAt: new Date(now),
      details: reason,
    });

    await this.writeProjectionSafely();

    const updatedTicket = await this.getTicket(ticketId);
    if (!updatedTicket) {
      throw new Error(`Superseded ticket ${ticketId} could not be loaded.`);
    }

    return updatedTicket;
  }

  async approveTicket(
    ticketId: string,
    reviewer: string,
    rationale = 'Approved by operator.'
  ): Promise<TaskTicket> {
    await this.ensureInitialized();

    if (this.usingFallback) {
      throw new Error(
        'Approval decisions are unavailable in markdown fallback mode. Enable SQLite to approve held tasks.'
      );
    }

    const reviewerName = reviewer.trim();
    if (!reviewerName) {
      throw new Error('approve requires a non-empty reviewer identity.');
    }

    const ticket = await this.getTicket(ticketId);
    if (!ticket) {
      throw new Error(`Ticket not found: ${ticketId}`);
    }

    const approval = requireApprovalState(ticket, 'requested', 'approve');
    const now = new Date();
    const updatedApproval: TaskApprovalState = {
      ...approval,
      status: 'approved',
      decisionAt: now,
      reviewer: reviewerName,
      rationale,
      approvalId: approval.approvalId ?? `approval_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
    };

    this.getDatabase()
      .prepare(
        `update tickets
         set updated_at = ?,
             approval_json = ?
         where id = ?`
      )
      .run(now.toISOString(), serializeApprovalState(updatedApproval), ticketId);

    const latestAttemptId = this.getLatestAttemptId(ticketId);
    if (latestAttemptId) {
      this.getDatabase()
        .prepare(
          `update ticket_attempts
           set approval_json = coalesce(?, approval_json)
           where id = ?`
        )
        .run(serializeApprovalState(updatedApproval), latestAttemptId);
    }

    this.recordEvent({
      ticketId,
      type: 'approval-approved',
      createdAt: now,
      details: formatApprovalEventDetails(updatedApproval),
      correlationId: updatedApproval.approvalId,
    });

    await this.writeProjectionSafely();

    const updatedTicket = await this.getTicket(ticketId);
    if (!updatedTicket) {
      throw new Error(`Approved ticket ${ticketId} could not be loaded.`);
    }

    return updatedTicket;
  }

  async rejectTicket(
    ticketId: string,
    reviewer: string,
    rationale = 'Rejected by operator.'
  ): Promise<TaskTicket> {
    await this.ensureInitialized();

    if (this.usingFallback) {
      throw new Error(
        'Approval decisions are unavailable in markdown fallback mode. Enable SQLite to reject held tasks.'
      );
    }

    const reviewerName = reviewer.trim();
    if (!reviewerName) {
      throw new Error('reject requires a non-empty reviewer identity.');
    }

    const ticket = await this.getTicket(ticketId);
    if (!ticket) {
      throw new Error(`Ticket not found: ${ticketId}`);
    }

    const approval = requireApprovalState(ticket, 'requested', 'reject');
    assertValidTaskTransition(ticket.status, 'blocked', `ticket ${ticket.id}`);

    const now = new Date();
    const updatedApproval: TaskApprovalState = {
      ...approval,
      status: 'rejected',
      decisionAt: now,
      reviewer: reviewerName,
      rationale,
    };
    const rejectionReason = `Approval rejected by ${reviewerName}: ${rationale}`;

    this.getDatabase()
      .prepare(
        `update tickets
         set status = 'blocked',
             updated_at = ?,
             blocked_at = ?,
             error = ?,
             approval_json = ?,
             current_attempt_id = null
         where id = ?`
      )
      .run(
        now.toISOString(),
        now.toISOString(),
        rejectionReason,
        serializeApprovalState(updatedApproval),
        ticketId
      );

    const latestAttemptId = this.getLatestAttemptId(ticketId);
    if (latestAttemptId) {
      this.getDatabase()
        .prepare(
          `update ticket_attempts
           set approval_json = coalesce(?, approval_json)
           where id = ?`
        )
        .run(serializeApprovalState(updatedApproval), latestAttemptId);
    }

    this.recordEvent({
      ticketId,
      type: 'approval-rejected',
      createdAt: now,
      details: formatApprovalEventDetails(updatedApproval),
      correlationId: updatedApproval.requestId,
    });
    this.recordEvent({
      ticketId,
      type: 'blocked',
      createdAt: now,
      details: rejectionReason,
      correlationId: updatedApproval.requestId,
    });

    await this.writeProjectionSafely();

    const updatedTicket = await this.getTicket(ticketId);
    if (!updatedTicket) {
      throw new Error(`Rejected ticket ${ticketId} could not be loaded.`);
    }

    return updatedTicket;
  }

  async resumeApprovedTicket(ticketId: string): Promise<TaskTicket> {
    await this.ensureInitialized();

    if (this.usingFallback) {
      throw new Error(
        'Approval-backed resume is unavailable in markdown fallback mode. Enable SQLite to resume held tasks.'
      );
    }

    const ticket = await this.getTicket(ticketId);
    if (!ticket) {
      throw new Error(`Ticket not found: ${ticketId}`);
    }

    const approval = requireApprovalState(ticket, 'approved', 'resume');
    if (!approval.approvalId) {
      throw new Error(`Ticket ${ticket.id} does not have an approval token and cannot be resumed.`);
    }

    const eligibility = resolveApprovedResumeEligibility(ticket);
    if (!eligibility.resumable) {
      if (eligibility.reason === 'missing_plan') {
        throw new Error(`Ticket ${ticket.id} does not have a persisted plan to resume.`);
      }

      if (eligibility.reason === 'missing_tool_calls') {
        throw new Error(`Ticket ${ticket.id} does not have persisted tool calls to resume.`);
      }

      if (eligibility.reason === 'missing_patch_apply') {
        throw new Error(`Ticket ${ticket.id} does not contain a resumable patch.apply tool call.`);
      }

      throw new Error(`Ticket ${ticket.id} cannot be resumed in its current state.`);
    }

    assertValidTaskTransition(ticket.status, 'pending', `ticket ${ticket.id}`);

    const now = new Date().toISOString();
    this.getDatabase()
      .prepare(
        `update tickets
         set status = 'pending',
             updated_at = ?,
             error = null,
             current_attempt_id = null,
             source_order = ?
         where id = ?`
      )
      .run(now, this.getNextSourceOrder(), ticketId);

    this.recordEvent({
      ticketId,
      type: 'approval-resumed',
      createdAt: new Date(now),
      details: formatApprovalEventDetails(approval),
      correlationId: approval.approvalId,
    });

    await this.writeProjectionSafely();

    const updatedTicket = await this.getTicket(ticketId);
    if (!updatedTicket) {
      throw new Error(`Resumed ticket ${ticketId} could not be loaded.`);
    }

    return updatedTicket;
  }

  async listAttempts(ticketId: string): Promise<TaskAttempt[]> {
    await this.ensureInitialized();

    if (this.usingFallback) {
      return [];
    }

    const rows = this.getDatabase()
      .prepare(
        `select *
         from ticket_attempts
         where ticket_id = ?
         order by attempt_number asc`
      )
      .all(ticketId) as unknown as TaskAttemptRow[];

    return rows.map((row) => this.mapAttemptRow(row));
  }

  async listAttemptsForTickets(ticketIds?: string[]): Promise<Map<string, TaskAttempt[]>> {
    await this.ensureInitialized();

    const attemptsByTicket = new Map<string, TaskAttempt[]>();
    const uniqueTicketIds = ticketIds === undefined
      ? undefined
      : [...new Set(ticketIds.filter((ticketId) => ticketId.trim().length > 0))];

    if (uniqueTicketIds) {
      for (const ticketId of uniqueTicketIds) {
        attemptsByTicket.set(ticketId, []);
      }
    }

    if (this.usingFallback || uniqueTicketIds?.length === 0) {
      return attemptsByTicket;
    }

    const rows: TaskAttemptRow[] = [];
    if (!uniqueTicketIds) {
      rows.push(
        ...(this.getDatabase()
          .prepare(
            `select *
             from ticket_attempts
             order by ticket_id asc, attempt_number asc`
          )
          .all() as unknown as TaskAttemptRow[])
      );
    } else {
      const chunkSize = 500;
      for (let start = 0; start < uniqueTicketIds.length; start += chunkSize) {
        const chunk = uniqueTicketIds.slice(start, start + chunkSize);
        const placeholders = chunk.map(() => '?').join(',');
        rows.push(
          ...(this.getDatabase()
            .prepare(
              `select *
               from ticket_attempts
               where ticket_id in (${placeholders})
               order by ticket_id asc, attempt_number asc`
            )
            .all(...chunk) as unknown as TaskAttemptRow[])
        );
      }
    }

    for (const row of rows) {
      const attempts = attemptsByTicket.get(row.ticket_id) ?? [];
      attempts.push(this.mapAttemptRow(row));
      attemptsByTicket.set(row.ticket_id, attempts);
    }

    return attemptsByTicket;
  }

  async createWorkerVersion(input: {
    attemptId: string;
    workspaceId?: string;
    workspaceRoot?: string;
    patchBundlePath?: string;
    verificationSummary?: string;
    status?: WorkerVersionStatus;
  }): Promise<WorkerVersion> {
    await this.ensureInitialized();

    if (this.usingFallback) {
      throw new Error('Worker version persistence is unavailable in markdown fallback mode.');
    }

    const attemptRow = this.getDatabase()
      .prepare('select id, workspace_id, workspace_root from ticket_attempts where id = ?')
      .get(input.attemptId) as { id: string; workspace_id: string | null; workspace_root: string | null } | undefined;
    if (!attemptRow) {
      throw new Error(`Attempt not found for worker version creation: ${input.attemptId}`);
    }

    const id = this.generateWorkerVersionId();
    const now = new Date().toISOString();
    const status = input.status ?? 'candidate';
    this.getDatabase()
      .prepare(
        `insert into worker_versions (
          id,
          attempt_id,
          workspace_id,
          workspace_root,
          patch_bundle_path,
          verification_summary,
          created_at,
          activated_at,
          status
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.attemptId,
        input.workspaceId ?? attemptRow.workspace_id,
        input.workspaceRoot ?? attemptRow.workspace_root,
        input.patchBundlePath ?? null,
        input.verificationSummary ?? null,
        now,
        null,
        status
      );

    const row = this.getDatabase()
      .prepare('select * from worker_versions where id = ?')
      .get(id) as WorkerVersionRow | undefined;
    if (!row) {
      throw new Error(`Worker version could not be loaded after creation: ${id}`);
    }

    return this.mapWorkerVersionRow(row);
  }

  async updateWorkerVersionStatus(workerVersionId: string, status: WorkerVersionStatus): Promise<WorkerVersion> {
    await this.ensureInitialized();

    if (this.usingFallback) {
      throw new Error('Worker version persistence is unavailable in markdown fallback mode.');
    }

    const row = this.getDatabase()
      .prepare('select * from worker_versions where id = ?')
      .get(workerVersionId) as WorkerVersionRow | undefined;
    if (!row) {
      throw new Error(`Worker version not found: ${workerVersionId}`);
    }

    assertValidWorkerVersionTransition(row.status, status, `worker version ${workerVersionId}`);
    const activatedAt = status === 'active' ? row.activated_at ?? new Date().toISOString() : row.activated_at;

    this.getDatabase()
      .prepare(
        `update worker_versions
         set status = ?,
             activated_at = ?
         where id = ?`
      )
      .run(status, activatedAt, workerVersionId);

    const updated = this.getDatabase()
      .prepare('select * from worker_versions where id = ?')
      .get(workerVersionId) as WorkerVersionRow | undefined;
    if (!updated) {
      throw new Error(`Worker version could not be loaded after update: ${workerVersionId}`);
    }

    return this.mapWorkerVersionRow(updated);
  }

  async listWorkerVersions(attemptId?: string): Promise<WorkerVersion[]> {
    await this.ensureInitialized();

    if (this.usingFallback) {
      return [];
    }

    const rows = (
      attemptId
        ? this.getDatabase()
            .prepare(
              `select *
               from worker_versions
               where attempt_id = ?
               order by created_at asc, id asc`
            )
            .all(attemptId)
        : this.getDatabase()
            .prepare(
              `select *
               from worker_versions
               order by created_at asc, id asc`
            )
            .all()
    ) as unknown as WorkerVersionRow[];

    return rows.map((row) => this.mapWorkerVersionRow(row));
  }

  async createPromotionRecord(input: {
    workerVersionId: string;
    approvedBy?: string;
    approvalId?: string;
  }): Promise<PromotionRecord> {
    await this.ensureInitialized();

    if (this.usingFallback) {
      throw new Error('Promotion persistence is unavailable in markdown fallback mode.');
    }

    const workerVersion = this.getDatabase()
      .prepare('select id from worker_versions where id = ?')
      .get(input.workerVersionId) as { id: string } | undefined;
    if (!workerVersion) {
      throw new Error(`Worker version not found for promotion creation: ${input.workerVersionId}`);
    }

    const id = this.generatePromotionRecordId();
    const now = new Date().toISOString();

    this.getDatabase()
      .prepare(
        `insert into promotion_records (
          id,
          worker_version_id,
          status,
          requested_at,
          updated_at,
          approved_by,
          approval_id,
          failure_reason,
          rollback_reason
        ) values (?, ?, 'requested', ?, ?, ?, ?, ?, ?)`
      )
      .run(id, input.workerVersionId, now, now, input.approvedBy ?? null, input.approvalId ?? null, null, null);

    const row = this.getDatabase()
      .prepare('select * from promotion_records where id = ?')
      .get(id) as PromotionRecordRow | undefined;
    if (!row) {
      throw new Error(`Promotion record could not be loaded after creation: ${id}`);
    }

    this.recordPromotionLifecycleEvent(row);

    return this.mapPromotionRecordRow(row);
  }

  async updatePromotionStatus(
    promotionId: string,
    status: PromotionStatus,
    metadata?: {
      failureReason?: string;
      rollbackReason?: string;
    }
  ): Promise<PromotionRecord> {
    await this.ensureInitialized();

    if (this.usingFallback) {
      throw new Error('Promotion persistence is unavailable in markdown fallback mode.');
    }

    const row = this.getDatabase()
      .prepare('select * from promotion_records where id = ?')
      .get(promotionId) as PromotionRecordRow | undefined;
    if (!row) {
      throw new Error(`Promotion record not found: ${promotionId}`);
    }

    if (row.status === status) {
      return this.mapPromotionRecordRow(row);
    }

    assertValidPromotionTransition(row.status, status, `promotion ${promotionId}`);

    this.getDatabase()
      .prepare(
        `update promotion_records
         set status = ?,
             updated_at = ?,
             failure_reason = coalesce(?, failure_reason),
             rollback_reason = coalesce(?, rollback_reason)
         where id = ?`
      )
      .run(status, new Date().toISOString(), metadata?.failureReason ?? null, metadata?.rollbackReason ?? null, promotionId);

    const updated = this.getDatabase()
      .prepare('select * from promotion_records where id = ?')
      .get(promotionId) as PromotionRecordRow | undefined;
    if (!updated) {
      throw new Error(`Promotion record could not be loaded after update: ${promotionId}`);
    }

    this.recordPromotionLifecycleEvent(updated);

    return this.mapPromotionRecordRow(updated);
  }

  async listPromotionRecords(workerVersionId?: string): Promise<PromotionRecord[]> {
    await this.ensureInitialized();

    if (this.usingFallback) {
      return [];
    }

    const rows = (
      workerVersionId
        ? this.getDatabase()
            .prepare(
              `select *
               from promotion_records
               where worker_version_id = ?
               order by requested_at asc, id asc`
            )
            .all(workerVersionId)
        : this.getDatabase()
            .prepare(
              `select *
               from promotion_records
               order by requested_at asc, id asc`
            )
            .all()
    ) as unknown as PromotionRecordRow[];

    return rows.map((row) => this.mapPromotionRecordRow(row));
  }

  async getRevisionStamp(): Promise<TicketStoreRevisionStamp> {
    await this.ensureInitialized();

    if (this.usingFallback) {
      const tasks = await this.fallbackWatcher.getPendingTasks();
      const latestTicketUpdateMs = tasks.reduce(
        (latest, task) => Math.max(latest, task.updatedAt?.getTime() ?? task.createdAt.getTime()),
        0
      );
      const value = [tasks.length, latestTicketUpdateMs, 0, 0].join(':');
      return {
        value,
        ticketCount: tasks.length,
        latestTicketUpdateMs,
        eventCount: 0,
        latestEventMs: 0,
      };
    }

    const ticketRow = this.getDatabase()
      .prepare('select count(*) as count, max(updated_at) as latest_updated_at from tickets')
      .get() as { count: number; latest_updated_at: string | null };
    const eventRow = this.getDatabase()
      .prepare('select count(*) as count, max(created_at) as latest_created_at from ticket_events')
      .get() as { count: number; latest_created_at: string | null };
    const latestTicketUpdateMs = parseTimestampMs(ticketRow.latest_updated_at);
    const latestEventMs = parseTimestampMs(eventRow.latest_created_at);

    return {
      value: [ticketRow.count, latestTicketUpdateMs, eventRow.count, latestEventMs].join(':'),
      ticketCount: ticketRow.count,
      latestTicketUpdateMs,
      eventCount: eventRow.count,
      latestEventMs,
    };
  }

  async getRepositoryReadiness(): Promise<Array<{ code: string; message: string; blocking: boolean }>> {
    try {
      await this.ensureInitialized();
    } catch (error) {
      return [
        {
          code: 'ticket-store-unavailable',
          message: `Ticket store unavailable: ${error instanceof Error ? error.message : String(error)}`,
          blocking: true,
        },
      ];
    }

    const issues: Array<{ code: string; message: string; blocking: boolean }> = [];
    if (this.usingFallback) {
      issues.push({
        code: 'markdown-fallback-active',
        message: 'Ticket store is running in markdown-only fallback mode.',
        blocking: false,
      });
    }

    const projectionHealth = this.getProjectionHealthStatus();
    if (!projectionHealth.healthy) {
      issues.push({
        code: 'task-board-projection-unhealthy',
        message: `TASKS.md projection unhealthy: ${projectionHealth.lastError}`,
        blocking: false,
      });
    }

    const projectionDrift = await this.getProjectionDriftStatus();
    if (projectionDrift.drifted) {
      issues.push({
        code: 'task-board-projection-drift',
        message: `${projectionDrift.reason} Run sync-board to rewrite it from the canonical store.`,
        blocking: false,
      });
    }

    return issues;
  }

  async enqueueTaskSideEffects(
    ticketId: string,
    sideEffects: PendingTaskSideEffect[]
  ): Promise<TaskSideEffect[]> {
    await this.ensureInitialized();

    if (this.usingFallback) {
      return [];
    }

    const ticket = await this.getTicket(ticketId);
    if (!ticket) {
      throw new Error(`Ticket not found for side effects: ${ticketId}`);
    }

    const inserted: TaskSideEffect[] = [];
    const statement = this.getDatabase().prepare(
      `insert or ignore into task_side_effects (
        id,
        ticket_id,
        attempt_id,
        correlation_id,
        effect_type,
        payload_json,
        status,
        idempotency_key,
        created_at,
        processed_at,
        last_error
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    for (const sideEffect of sideEffects) {
      const createdAt = new Date().toISOString();
      const sideEffectId = this.generateSideEffectId();
      const attemptId = sideEffect.attemptId ?? ticket.currentAttemptId ?? null;
      const result = statement.run(
        sideEffectId,
        ticketId,
        attemptId,
        sideEffect.correlationId ?? null,
        sideEffect.type,
        JSON.stringify(sideEffect.payload),
        'pending',
        sideEffect.idempotencyKey,
        createdAt,
        null,
        null
      ) as { changes?: number };

      const row = this.getDatabase()
        .prepare('select * from task_side_effects where idempotency_key = ?')
        .get(sideEffect.idempotencyKey) as TaskSideEffectRow | undefined;

      if (!row) {
        throw new Error(`Side effect could not be loaded after enqueue: ${sideEffect.idempotencyKey}`);
      }

      if ((result.changes ?? 0) > 0) {
        this.recordEvent({
          ticketId,
          type: 'side-effect-enqueued',
          createdAt: new Date(createdAt),
          details: `${sideEffect.type}:${sideEffect.idempotencyKey}`,
          evidence: {
            sideEffectType: sideEffect.type,
            idempotencyKey: sideEffect.idempotencyKey,
            attemptId,
            status: 'pending',
          },
          correlationId: sideEffect.correlationId,
        });
      }

      inserted.push(this.mapSideEffectRow(row));
    }

    return inserted;
  }

  async markTaskSideEffectProcessed(id: string): Promise<void> {
    await this.ensureInitialized();

    if (this.usingFallback) {
      return;
    }

    const row = this.getDatabase()
      .prepare('select * from task_side_effects where id = ?')
      .get(id) as TaskSideEffectRow | undefined;
    if (!row) {
      throw new Error(`Side effect not found: ${id}`);
    }

    const processedAt = new Date().toISOString();
    this.getDatabase()
      .prepare(
        `update task_side_effects
         set status = 'completed',
             processed_at = ?,
             last_error = null
         where id = ?`
      )
      .run(processedAt, id);
    this.recordEvent({
      ticketId: row.ticket_id,
      type: 'side-effect-completed',
      createdAt: new Date(processedAt),
      details: `${row.effect_type}:${row.idempotency_key}`,
      evidence: {
        sideEffectType: row.effect_type,
        idempotencyKey: row.idempotency_key,
        status: 'completed',
      },
      correlationId: row.correlation_id ?? undefined,
    });
  }

  async markTaskSideEffectFailed(id: string, error: string): Promise<void> {
    await this.ensureInitialized();

    if (this.usingFallback) {
      return;
    }

    const row = this.getDatabase()
      .prepare('select * from task_side_effects where id = ?')
      .get(id) as TaskSideEffectRow | undefined;
    if (!row) {
      throw new Error(`Side effect not found: ${id}`);
    }

    const processedAt = new Date().toISOString();
    this.getDatabase()
      .prepare(
        `update task_side_effects
         set status = 'failed',
             processed_at = ?,
             last_error = ?
         where id = ?`
      )
      .run(processedAt, error, id);
    this.recordEvent({
      ticketId: row.ticket_id,
      type: 'side-effect-failed',
      createdAt: new Date(processedAt),
      details: `${row.effect_type}:${error}`,
      evidence: {
        sideEffectType: row.effect_type,
        idempotencyKey: row.idempotency_key,
        status: 'failed',
        error,
      },
      correlationId: row.correlation_id ?? undefined,
    });
  }

  async listTaskSideEffects(ticketId?: string): Promise<TaskSideEffect[]> {
    await this.ensureInitialized();

    if (this.usingFallback) {
      return [];
    }

    const rows = (
      ticketId
        ? this.getDatabase()
            .prepare(
              `select *
               from task_side_effects
               where ticket_id = ?
               order by created_at asc, rowid asc`
            )
            .all(ticketId)
        : this.getDatabase()
            .prepare(
              `select *
               from task_side_effects
               order by created_at asc, rowid asc`
            )
            .all()
    ) as unknown as TaskSideEffectRow[];

    return rows.map((row) => this.mapSideEffectRow(row));
  }

  async appendTaskAttemptArtifacts(ticketId: string, artifacts: string[]): Promise<void> {
    await this.ensureInitialized();

    if (this.usingFallback || artifacts.length === 0) {
      return;
    }

    const ticket = await this.getTicket(ticketId);
    if (!ticket?.currentAttemptId) {
      return;
    }

    const row = this.getDatabase()
      .prepare('select artifacts_json from ticket_attempts where id = ?')
      .get(ticket.currentAttemptId) as { artifacts_json: string | null } | undefined;
    if (!row) {
      return;
    }

    const existingArtifacts = row.artifacts_json
      ? (JSON.parse(row.artifacts_json) as string[])
      : [];
    const mergedArtifacts = [...existingArtifacts, ...artifacts];

    this.getDatabase()
      .prepare('update ticket_attempts set artifacts_json = ? where id = ?')
      .run(JSON.stringify(mergedArtifacts), ticket.currentAttemptId);
  }

  async renderTaskBoardProjection(): Promise<string> {
    await this.ensureInitialized();

    if (this.usingFallback) {
      return this.readTaskBoard();
    }

    return renderTaskBoard(this.listAllTasks());
  }

  async syncProjection(): Promise<void> {
    await this.ensureInitialized();
    await this.writeProjectionSafely(true);
  }

  getProjectionHealthStatus(): ProjectionHealthStatus {
    return {
      healthy: this.projectionLastError === null,
      lastError: this.projectionLastError ?? undefined,
      retryScheduled: this.projectionRetryTimer !== null,
      nextRetryDelayMs: this.projectionScheduledRetryDelayMs ?? undefined,
      consecutiveFailures: this.projectionConsecutiveFailures,
    };
  }

  async getProjectionDriftStatus(): Promise<ProjectionDriftStatus> {
    await this.ensureInitialized();

    if (!this.projectionEnabled || this.usingFallback) {
      return {
        checked: false,
        drifted: false,
        reason: 'Projection is disabled or markdown fallback is active.',
      };
    }

    try {
      const projectedContent = await fs.readFile(this.tasksFile, 'utf-8');
      const canonicalContent = renderTaskBoard(this.listAllTasks());
      const drifted =
        normalizeProjectionForComparison(projectedContent) !==
        normalizeProjectionForComparison(canonicalContent);

      return {
        checked: true,
        drifted,
        reason: drifted ? 'TASKS.md differs from the canonical ticket store projection.' : undefined,
      };
    } catch (error) {
      const errorCode = (error as NodeJS.ErrnoException).code;
      return {
        checked: true,
        drifted: true,
        reason: errorCode === 'ENOENT'
          ? 'TASKS.md projection is missing.'
          : `TASKS.md projection could not be read: ${String(error)}`,
      };
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialization) {
      this.initialization = this.initialize();
    }

    await this.initialization;
  }

  private async initialize(): Promise<void> {
    if (this.forceMarkdownFallback) {
      this.usingFallback = true;
      logger.warn('Using markdown-only task repository fallback by configuration');
      return;
    }

    try {
      const sqlite = await import('node:sqlite');
      this.db = new sqlite.DatabaseSync(this.storeFile);
      this.db.exec(`
        PRAGMA busy_timeout = 5000;
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;

        create table if not exists tickets (
          id text primary key,
          description text not null,
          description_key text not null,
          status text not null,
          created_at text not null,
          updated_at text not null,
          started_at text,
          completed_at text,
          blocked_at text,
          cancelled_at text,
          current_attempt_id text,
          result text,
          error text,
          plan_json text,
          tool_calls_json text,
          approval_json text,
          attempt_count integer not null default 0,
          source_order integer not null
        );

        create index if not exists idx_tickets_status_source_order
          on tickets(status, source_order);

        create index if not exists idx_tickets_description_key
          on tickets(description_key);

        create table if not exists ticket_events (
          id integer primary key autoincrement,
          ticket_id text not null,
          event_type text not null,
          details text,
          evidence_json text,
          correlation_id text,
          created_at text not null
        );

        create index if not exists idx_ticket_events_ticket_created
          on ticket_events(ticket_id, created_at);

        create table if not exists domain_events (
          id text primary key,
          ticket_id text not null,
          event_type text not null,
          details text,
          evidence_json text,
          correlation_id text,
          legacy_event_id integer,
          created_at text not null
        );

        create index if not exists idx_domain_events_ticket_created
          on domain_events(ticket_id, created_at);

        create index if not exists idx_domain_events_type_created
          on domain_events(event_type, created_at);

        create unique index if not exists idx_domain_events_legacy_event_id
          on domain_events(legacy_event_id)
          where legacy_event_id is not null;

        create table if not exists event_evidence (
          id integer primary key autoincrement,
          domain_event_id text not null,
          ticket_id text not null,
          evidence_key text not null,
          evidence_value_json text not null,
          created_at text not null
        );

        create index if not exists idx_event_evidence_event
          on event_evidence(domain_event_id);

        create index if not exists idx_event_evidence_ticket_created
          on event_evidence(ticket_id, created_at);

        create unique index if not exists idx_event_evidence_event_key
          on event_evidence(domain_event_id, evidence_key);

        create table if not exists ticket_attempts (
          id text primary key,
          ticket_id text not null,
          attempt_number integer not null,
          status text not null,
          workspace_id text,
          workspace_root text,
          isolation_mode text,
          started_at text not null,
          ended_at text,
          result text,
          error text,
          plan_json text,
          tool_calls_json text,
          approval_json text,
          artifacts_json text,
          unique(ticket_id, attempt_number)
        );

        create index if not exists idx_ticket_attempts_ticket_number
          on ticket_attempts(ticket_id, attempt_number);

        create table if not exists worker_versions (
          id text primary key,
          attempt_id text not null,
          workspace_id text,
          workspace_root text,
          patch_bundle_path text,
          verification_summary text,
          created_at text not null,
          activated_at text,
          status text not null
        );

        create index if not exists idx_worker_versions_attempt_created
          on worker_versions(attempt_id, created_at);

        create table if not exists promotion_records (
          id text primary key,
          worker_version_id text not null,
          status text not null,
          requested_at text not null,
          updated_at text not null,
          approved_by text,
          approval_id text,
          failure_reason text,
          rollback_reason text
        );

        create index if not exists idx_promotion_records_worker_requested
          on promotion_records(worker_version_id, requested_at);

        create table if not exists task_side_effects (
          id text primary key,
          ticket_id text not null,
          attempt_id text,
          correlation_id text,
          effect_type text not null,
          payload_json text not null,
          status text not null,
          idempotency_key text not null unique,
          created_at text not null,
          processed_at text,
          last_error text
        );

        create index if not exists idx_task_side_effects_ticket_created
          on task_side_effects(ticket_id, created_at);

        create index if not exists idx_task_side_effects_status_created
          on task_side_effects(status, created_at);

        create table if not exists schema_migrations (
          version integer primary key,
          description text not null,
          applied_at text not null
        );
      `);

      this.applySchemaMigrations();

      await this.bootstrapLegacyTaskBoardIfStoreEmpty();
      const recoveredStaleTickets = this.recoverStaleActiveTickets();
      if (recoveredStaleTickets > 0) {
        logger.warn('Recovered stale active tickets during store initialization', {
          recoveredStaleTickets,
          storeFile: this.storeFile,
        });
      }
      await this.writeProjectionSafely(true);
    } catch (error) {
      if (this.db) {
        this.db.close();
        this.db = null;
      }

      if (this.allowMarkdownFallback) {
        this.usingFallback = true;
        logger.warn('Falling back to markdown-only task repository', {
          error: String(error),
          storeFile: this.storeFile,
        });
        return;
      }

      throw new Error(
        `Ticket store initialization failed and markdown fallback is disabled: ${String(error)}`
      );
    }
  }

  private async bootstrapLegacyTaskBoardIfStoreEmpty(): Promise<void> {
    const db = this.getDatabase();
    const countRow = db.prepare('select count(*) as count from tickets').get() as { count: number };
    if (countRow.count > 0 || !this.importLegacyTaskBoardIfStoreEmpty) {
      return;
    }

    const content = await this.readTaskBoard();
    const items = parseTaskBoard(content);
    for (const item of items) {
      this.insertTicket({
        id: item.id ?? this.generateTicketId(),
        description: item.description,
        status: item.status,
        sourceOrder: item.sourceOrder,
      });
    }
  }

  private applySchemaMigrations(): void {
    const db = this.getDatabase();
    const ticketColumns = db.prepare('pragma table_info(tickets)').all() as Array<{ name: string }>;
    const ticketColumnNames = new Set(ticketColumns.map((column) => column.name));
    const ticketEventColumns = db.prepare('pragma table_info(ticket_events)').all() as Array<{ name: string }>;
    const ticketEventColumnNames = new Set(ticketEventColumns.map((column) => column.name));

    if (!ticketColumnNames.has('current_attempt_id')) {
      db.exec('alter table tickets add column current_attempt_id text;');
    }

    if (!ticketColumnNames.has('tool_calls_json')) {
      db.exec('alter table tickets add column tool_calls_json text;');
    }

    if (!ticketColumnNames.has('approval_json')) {
      db.exec('alter table tickets add column approval_json text;');
    }

    if (!ticketEventColumnNames.has('correlation_id')) {
      db.exec('alter table ticket_events add column correlation_id text;');
    }

    if (!ticketEventColumnNames.has('evidence_json')) {
      db.exec('alter table ticket_events add column evidence_json text;');
    }

    db.exec(`
      create table if not exists domain_events (
        id text primary key,
        ticket_id text not null,
        event_type text not null,
        details text,
        evidence_json text,
        correlation_id text,
        legacy_event_id integer,
        created_at text not null
      );

      create index if not exists idx_domain_events_ticket_created
        on domain_events(ticket_id, created_at);

      create index if not exists idx_domain_events_type_created
        on domain_events(event_type, created_at);

      create unique index if not exists idx_domain_events_legacy_event_id
        on domain_events(legacy_event_id)
        where legacy_event_id is not null;

      create table if not exists event_evidence (
        id integer primary key autoincrement,
        domain_event_id text not null,
        ticket_id text not null,
        evidence_key text not null,
        evidence_value_json text not null,
        created_at text not null
      );

      create index if not exists idx_event_evidence_event
        on event_evidence(domain_event_id);

      create index if not exists idx_event_evidence_ticket_created
        on event_evidence(ticket_id, created_at);

      create unique index if not exists idx_event_evidence_event_key
        on event_evidence(domain_event_id, evidence_key);

      create table if not exists worker_versions (
        id text primary key,
        attempt_id text not null,
        workspace_id text,
        workspace_root text,
        patch_bundle_path text,
        verification_summary text,
        created_at text not null,
        activated_at text,
        status text not null
      );

      create index if not exists idx_worker_versions_attempt_created
        on worker_versions(attempt_id, created_at);

      create table if not exists promotion_records (
        id text primary key,
        worker_version_id text not null,
        status text not null,
        requested_at text not null,
        updated_at text not null,
        approved_by text,
        approval_id text,
        failure_reason text,
        rollback_reason text
      );

      create index if not exists idx_promotion_records_worker_requested
        on promotion_records(worker_version_id, requested_at);
    `);

    const attemptColumns = db.prepare('pragma table_info(ticket_attempts)').all() as Array<{ name: string }>;
    const attemptColumnNames = new Set(attemptColumns.map((column) => column.name));
    if (!attemptColumnNames.has('tool_calls_json')) {
      db.exec('alter table ticket_attempts add column tool_calls_json text;');
    }

    if (!attemptColumnNames.has('approval_json')) {
      db.exec('alter table ticket_attempts add column approval_json text;');
    }

    if (!attemptColumnNames.has('workspace_id')) {
      db.exec('alter table ticket_attempts add column workspace_id text;');
    }

    if (!attemptColumnNames.has('workspace_root')) {
      db.exec('alter table ticket_attempts add column workspace_root text;');
    }

    if (!attemptColumnNames.has('isolation_mode')) {
      db.exec('alter table ticket_attempts add column isolation_mode text;');
    }

    db.prepare(
      `insert or ignore into schema_migrations (version, description, applied_at)
       values (?, ?, ?)`
    ).run(
      1,
      'add durable ticket attempts and current attempt tracking',
      new Date().toISOString()
    );

    db.prepare(
      `insert or ignore into schema_migrations (version, description, applied_at)
       values (?, ?, ?)`
    ).run(
      2,
      'add correlation-aware side effect outbox records',
      new Date().toISOString()
    );

    db.prepare(
      `insert or ignore into schema_migrations (version, description, applied_at)
       values (?, ?, ?)`
    ).run(
      3,
      'persist approval state and pending tool calls for resume workflows',
      new Date().toISOString()
    );

    db.prepare(
      `insert or ignore into schema_migrations (version, description, applied_at)
       values (?, ?, ?)`
    ).run(
      4,
      'add structured event evidence payloads to ticket_events',
      new Date().toISOString()
    );

    db.prepare(
      `insert or ignore into schema_migrations (version, description, applied_at)
       values (?, ?, ?)`
    ).run(
      5,
      'add canonical domain_events stream and event_evidence rows',
      new Date().toISOString()
    );

    db.prepare(
      `insert or ignore into schema_migrations (version, description, applied_at)
       values (?, ?, ?)`
    ).run(
      6,
      'persist ticket attempt workspace binding metadata',
      new Date().toISOString()
    );

    db.prepare(
      `insert or ignore into schema_migrations (version, description, applied_at)
       values (?, ?, ?)`
    ).run(
      7,
      'persist D5 worker versions and promotion records',
      new Date().toISOString()
    );

    this.backfillDomainEventsFromLegacy();
    this.backfillEventEvidenceFromDomainEvents();
  }

  private backfillDomainEventsFromLegacy(): void {
    const db = this.getDatabase();
    db.prepare(
      `insert into domain_events (
         id,
         ticket_id,
         event_type,
         details,
         evidence_json,
         correlation_id,
         legacy_event_id,
         created_at
       )
       select
         'legacy_event_' || printf('%012d', te.id),
         te.ticket_id,
         te.event_type,
         te.details,
         te.evidence_json,
         te.correlation_id,
         te.id,
         te.created_at
       from ticket_events te
       left join domain_events de on de.legacy_event_id = te.id
       where de.id is null
       order by te.id asc`
    ).run();
  }

  private backfillEventEvidenceFromDomainEvents(): void {
    const db = this.getDatabase();
    const rows = db
      .prepare(
        `select id, ticket_id, event_type, details, evidence_json, correlation_id, legacy_event_id, created_at
         from domain_events
         where evidence_json is not null
         order by created_at asc, id asc`
      )
      .all() as unknown as DomainEventRow[];

    if (rows.length === 0) {
      return;
    }

    const insertEvidence = db.prepare(
      `insert or ignore into event_evidence (
         domain_event_id,
         ticket_id,
         evidence_key,
         evidence_value_json,
         created_at
       )
       values (?, ?, ?, ?, ?)`
    );

    for (const event of rows) {
      const evidenceRows = toEventEvidenceRows(event);
      for (const row of evidenceRows) {
        insertEvidence.run(
          row.domain_event_id,
          row.ticket_id,
          row.evidence_key,
          row.evidence_value_json,
          row.created_at
        );
      }
    }
  }

  private recoverStaleActiveTickets(): number {
    const db = this.getDatabase();
    const rows = db
      .prepare(
        `select *
         from tickets
         where status in ('in_progress', 'planned', 'applying', 'verifying')
            or current_attempt_id is not null
         order by updated_at asc`
      )
      .all() as unknown as TicketRow[];
    const now = new Date().toISOString();
    const nowMs = Date.parse(now);
    let recoveredTicketCount = 0;

    for (const row of rows) {
      const updatedAtMs = Date.parse(row.updated_at);
      const ageMs = Number.isFinite(updatedAtMs) ? nowMs - updatedAtMs : Number.POSITIVE_INFINITY;
      if (ageMs < this.staleRecoveryMinAgeMs) {
        continue;
      }

      const recoveredAttemptIds = this.closeOpenAttemptsForTicket(
        row.id,
        now,
        'stale',
        staleRecoveryReason
      );

      if (staleRecoverableStatuses.has(row.status)) {
        db.prepare(
          `update tickets
           set status = 'stale',
               updated_at = ?,
               blocked_at = coalesce(blocked_at, ?),
               error = coalesce(error, ?),
               current_attempt_id = null
           where id = ?`
        ).run(now, now, staleRecoveryReason, row.id);
        recoveredTicketCount += 1;

        this.recordEvent({
          ticketId: row.id,
          type: 'stale-recovered',
          createdAt: new Date(now),
          details: staleRecoveryReason,
        });
      } else if (row.current_attempt_id || recoveredAttemptIds.length > 0) {
        db.prepare(
          `update tickets
           set updated_at = ?,
               current_attempt_id = null
           where id = ?`
        ).run(now, row.id);

        this.recordEvent({
          ticketId: row.id,
          type: 'stale-recovered',
          createdAt: new Date(now),
          details: 'Cleared orphaned active attempt metadata without changing terminal ticket status.',
        });
      }

      for (const attemptId of recoveredAttemptIds) {
        this.recordEvent({
          ticketId: row.id,
          type: 'attempt-finished',
          createdAt: new Date(now),
          details: attemptId,
        });
      }
    }

    return recoveredTicketCount;
  }

  private async dispatchPendingTasks(): Promise<void> {
    if (this.dispatchInProgress) {
      return;
    }

    const dispatchStartedAt = Date.now();
    this.dispatchInProgress = true;
    let pendingCount = 0;
    let dispatchedCount = 0;
    let redispatchDueCount = 0;
    try {
      const tasks = this.listTasksByStatus('pending');
      pendingCount = tasks.length;
      const now = Date.now();
      const newTasks = tasks.filter((task) => {
        if (this.pendingDispatchInFlight.has(task.id)) {
          return false;
        }

        if (!this.knownPendingTaskIds.has(task.id)) {
          return true;
        }

        const due = (this.pendingRedispatchAfter.get(task.id) ?? Number.POSITIVE_INFINITY) <= now;
        if (due) {
          redispatchDueCount += 1;
        }

        return due;
      });

      this.knownPendingTaskIds.clear();
      for (const task of tasks) {
        this.knownPendingTaskIds.add(task.id);
      }

      if (newTasks.length === 0 || !this.onNewTask) {
        return;
      }

      logger.info(`Found ${newTasks.length} new task(s) in the ticket store`);
      for (const task of newTasks) {
        this.pendingDispatchInFlight.add(task.id);
        try {
          await this.onNewTask(task);
        } finally {
          this.pendingDispatchInFlight.delete(task.id);
        }

        const refreshedTicket = await this.getTicket(task.id);
        if (refreshedTicket?.status === 'pending') {
          const currentDelayMs = this.pendingRedispatchDelayMs.get(task.id) ?? this.redispatchPendingAfterMs;
          this.pendingRedispatchAfter.set(task.id, Date.now() + currentDelayMs);
          const nextDelayMs = Math.min(
            this.redispatchPendingMaxAfterMs,
            Math.max(
              this.redispatchPendingAfterMs,
              Math.floor(currentDelayMs * this.redispatchBackoffMultiplier)
            )
          );
          this.pendingRedispatchDelayMs.set(task.id, nextDelayMs);
        } else {
          this.pendingRedispatchAfter.delete(task.id);
          this.pendingRedispatchDelayMs.delete(task.id);
        }
      }

      dispatchedCount = newTasks.length;
    } finally {
      this.dispatchInProgress = false;
      if (this.onNewTask) {
        const dispatchDurationMs = Math.max(0, Date.now() - dispatchStartedAt);
        this.schedulePendingDispatch(
          this.computeNextPollInterval(
            pendingCount,
            dispatchedCount,
            redispatchDueCount,
            dispatchDurationMs
          )
        );
      }
    }
  }

  private computeNextPollInterval(
    pendingCount: number,
    dispatchedCount: number,
    redispatchDueCount: number,
    dispatchDurationMs: number
  ): number {
    if (pendingCount === 0) {
      this.currentPollIntervalMs = Math.min(this.currentPollIntervalMs * 2, 5_000);
      return this.currentPollIntervalMs;
    }

    const queuePressure = pendingCount >= 5;

    if (dispatchedCount > 0) {
      if (redispatchDueCount > 0) {
        this.currentPollIntervalMs = 100;
        return this.currentPollIntervalMs;
      }

      if (queuePressure) {
        this.currentPollIntervalMs = 150;
        return this.currentPollIntervalMs;
      }

      if (dispatchDurationMs > this.pollingIntervalMs) {
        this.currentPollIntervalMs = Math.max(200, Math.floor(this.pollingIntervalMs / 2));
        return this.currentPollIntervalMs;
      }

      this.currentPollIntervalMs = Math.max(250, Math.floor(this.pollingIntervalMs / 2));
      return this.currentPollIntervalMs;
    }

    if (redispatchDueCount > 0) {
      this.currentPollIntervalMs = 200;
      return this.currentPollIntervalMs;
    }

    if (queuePressure) {
      this.currentPollIntervalMs = Math.max(250, Math.floor(this.pollingIntervalMs / 2));
      return this.currentPollIntervalMs;
    }

    this.currentPollIntervalMs = this.pollingIntervalMs;
    return this.currentPollIntervalMs;
  }

  private schedulePendingDispatch(delayMs: number): void {
    if (this.pendingPollTimer || !this.onNewTask) {
      return;
    }

    this.pendingPollTimer = setTimeout(() => {
      this.pendingPollTimer = null;
      void this.dispatchPendingTasks();
    }, Math.max(100, delayMs));
  }

  private insertTicket(input: {
    id: string;
    description: string;
    status: TaskStatus;
    sourceOrder: number;
  }): void {
    const now = new Date().toISOString();
    const sourceGroundingKeys = extractSourceGroundingKeys(input.description);
    this.getDatabase()
      .prepare(
        `insert into tickets (
          id,
          description,
          description_key,
          status,
          created_at,
          updated_at,
          attempt_count,
          source_order
        ) values (?, ?, ?, ?, ?, ?, 0, ?)`
      )
      .run(
        input.id,
        input.description,
        createDescriptionKey(input.description),
        input.status,
        now,
        now,
        input.sourceOrder
      );
    this.recordEvent({
      ticketId: input.id,
      type: 'created',
      createdAt: new Date(now),
      details: input.description,
      evidence: {
        sourceOrder: input.sourceOrder,
        descriptionKey: createDescriptionKey(input.description),
        ...(sourceGroundingKeys.length > 0
          ? {
              sourceGroundingKeys,
              sourceGroundingCount: sourceGroundingKeys.length,
            }
          : {}),
      },
    });
  }

  private insertAttempt(input: {
    id: string;
    ticketId: string;
    attemptNumber: number;
    status: TaskAttemptStatus;
    workspaceId?: string;
    workspaceRoot?: string;
    isolationMode?: 'shared-root' | 'isolated-workspace';
    startedAt: string;
  }): void {
    this.getDatabase()
      .prepare(
        `insert into ticket_attempts (
          id,
          ticket_id,
          attempt_number,
          status,
          workspace_id,
          workspace_root,
          isolation_mode,
          started_at,
          artifacts_json
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.id,
        input.ticketId,
        input.attemptNumber,
        input.status,
        input.workspaceId ?? null,
        input.workspaceRoot ?? null,
        input.isolationMode ?? null,
        input.startedAt,
        JSON.stringify([])
      );
  }

  async bindCurrentAttemptWorkspace(
    ticketId: string,
    binding: {
      workspaceId: string;
      workspaceRoot: string;
      isolationMode: 'shared-root' | 'isolated-workspace';
    }
  ): Promise<void> {
    await this.ensureInitialized();

    if (this.usingFallback) {
      return;
    }

    const ticket = this.getDatabase()
      .prepare('select current_attempt_id from tickets where id = ?')
      .get(ticketId) as { current_attempt_id: string | null } | undefined;
    const attemptId = ticket?.current_attempt_id ?? this.getLatestOpenAttemptId(ticketId);
    if (!attemptId) {
      return;
    }

    this.getDatabase()
      .prepare(
        `update ticket_attempts
         set workspace_id = ?,
             workspace_root = ?,
             isolation_mode = ?
         where id = ?`
      )
      .run(
        binding.workspaceId,
        binding.workspaceRoot,
        binding.isolationMode,
        attemptId
      );
  }

  private finishCurrentAttempt(
    ticket: TicketRow,
    update: {
      status: TaskAttemptStatus;
      endedAt: string;
      result?: string;
      error?: string;
      planJson?: string;
      toolCallsJson?: string | null;
      approvalJson?: string | null;
    }
  ): void {
    const attemptId = ticket.current_attempt_id ?? this.getLatestOpenAttemptId(ticket.id);
    if (!attemptId) {
      return;
    }

    const currentAttempt = this.getDatabase()
      .prepare('select status from ticket_attempts where id = ?')
      .get(attemptId) as { status: TaskAttemptStatus } | undefined;
    if (currentAttempt) {
      resolveTaskAttemptStatusTransition(currentAttempt.status, update.status, `attempt ${attemptId}`);
    }

    this.getDatabase()
      .prepare(
        `update ticket_attempts
         set status = ?,
             ended_at = ?,
             result = coalesce(?, result),
             error = coalesce(?, error),
             plan_json = coalesce(?, plan_json),
             tool_calls_json = coalesce(?, tool_calls_json),
             approval_json = coalesce(?, approval_json)
         where id = ?`
      )
      .run(
        update.status,
        update.endedAt,
        update.result ?? null,
        update.error ?? null,
        update.planJson ?? null,
        update.toolCallsJson ?? null,
        update.approvalJson ?? null,
        attemptId
      );
  }

  private closeOpenAttemptsForTicket(
    ticketId: string,
    endedAt: string,
    status: TaskAttemptStatus,
    error: string
  ): string[] {
    const rows = this.getDatabase()
      .prepare(
        `select id, status
         from ticket_attempts
         where ticket_id = ?
           and ended_at is null
         order by attempt_number asc`
      )
      .all(ticketId) as unknown as Array<{ id: string; status: TaskAttemptStatus }>;

    for (const row of rows) {
      const settledStatus = resolveTaskAttemptStatusTransition(row.status, status, `attempt ${row.id}`);
      this.getDatabase()
        .prepare(
          `update ticket_attempts
           set status = ?,
               ended_at = ?,
               error = coalesce(error, ?)
           where id = ?`
        )
        .run(settledStatus, endedAt, error, row.id);
    }

    return rows.map((row) => row.id);
  }

  private getLatestAttemptId(ticketId: string): string | null {
    const row = this.getDatabase()
      .prepare(
        `select id
         from ticket_attempts
         where ticket_id = ?
         order by attempt_number desc
         limit 1`
      )
      .get(ticketId) as { id: string } | undefined;

    return row?.id ?? null;
  }

  private getLatestOpenAttemptId(ticketId: string): string | null {
    const row = this.getDatabase()
      .prepare(
        `select id
         from ticket_attempts
         where ticket_id = ?
           and ended_at is null
         order by attempt_number desc
         limit 1`
      )
      .get(ticketId) as { id: string } | undefined;

    return row?.id ?? null;
  }

  private getNextAttemptNumber(ticketId: string): number {
    const row = this.getDatabase()
      .prepare(
        `select coalesce(max(attempt_number), 0) + 1 as next_attempt_number
         from ticket_attempts
         where ticket_id = ?`
      )
      .get(ticketId) as { next_attempt_number: number };

    return row.next_attempt_number;
  }

  private findTicketForTask(task: Task): TicketRow | null {
    const db = this.getDatabase();
    const byId = db.prepare('select * from tickets where id = ?').get(task.id) as TicketRow | undefined;
    if (byId) {
      return byId;
    }

    return (
      (db
        .prepare(
          `select *
           from tickets
           where description_key = ?
           order by created_at desc
           limit 1`
        )
        .get(createDescriptionKey(task.description)) as TicketRow | undefined) ?? null
    );
  }

  private listTasksByStatus(status: TaskStatus): TaskTicket[] {
    const rows = this.getDatabase()
      .prepare(
        `select *
         from tickets
         where status = ?
         order by source_order asc, created_at asc`
      )
      .all(status) as unknown as TicketRow[];

    return rows.map((row) => this.mapRowToTask(row));
  }

  private listAllTasks(): TaskTicket[] {
    const rows = this.getDatabase()
      .prepare(
        `select *
         from tickets
         order by source_order asc, created_at asc`
      )
      .all() as unknown as TicketRow[];

    return rows.map((row) => this.mapRowToTask(row));
  }

  private getNextSourceOrder(): number {
    const row = this.getDatabase()
      .prepare('select coalesce(max(source_order), 0) + 1 as next_order from tickets')
      .get() as { next_order: number };
    return row.next_order;
  }

  private mapRowToTask(row: TicketRow): TaskTicket {
    return {
      id: row.id,
      description: row.description,
      status: row.status,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      startedAt: row.started_at ? new Date(row.started_at) : undefined,
      completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
      blockedAt: row.blocked_at ? new Date(row.blocked_at) : undefined,
      cancelledAt: row.cancelled_at ? new Date(row.cancelled_at) : undefined,
      currentAttemptId: row.current_attempt_id ?? undefined,
      result: row.result ?? undefined,
      error: row.error ?? undefined,
      plan: row.plan_json ? JSON.parse(row.plan_json) : undefined,
      toolCalls: parseToolCalls(row.tool_calls_json),
      approval: parseApprovalState(row.approval_json),
      attemptCount: row.attempt_count,
      sourceOrder: row.source_order,
    };
  }

  private mapAttemptRow(row: TaskAttemptRow): TaskAttempt {
    return {
      id: row.id,
      ticketId: row.ticket_id,
      attemptNumber: row.attempt_number,
      status: row.status,
      workspaceId: row.workspace_id ?? undefined,
      workspaceRoot: row.workspace_root ?? undefined,
      isolationMode: row.isolation_mode ?? undefined,
      startedAt: new Date(row.started_at),
      endedAt: row.ended_at ? new Date(row.ended_at) : undefined,
      result: row.result ?? undefined,
      error: row.error ?? undefined,
      plan: row.plan_json ? JSON.parse(row.plan_json) : undefined,
      toolCalls: parseToolCalls(row.tool_calls_json),
      approval: parseApprovalState(row.approval_json),
      artifacts: row.artifacts_json ? JSON.parse(row.artifacts_json) as string[] : [],
    };
  }

  private mapEventRow(row: TicketEventRow): TaskEvent {
    return {
      ticketId: row.ticket_id,
      type: row.event_type,
      details: row.details ?? undefined,
      evidence: parseEventEvidence(row.evidence_json),
      correlationId: row.correlation_id ?? undefined,
      createdAt: new Date(row.created_at),
    };
  }

  private mapDomainEventRow(row: DomainEventRow): TaskEvent {
    return {
      ticketId: row.ticket_id,
      type: row.event_type,
      details: row.details ?? undefined,
      evidence: parseEventEvidence(row.evidence_json),
      correlationId: row.correlation_id ?? undefined,
      createdAt: new Date(row.created_at),
    };
  }

  private mapSideEffectRow(row: TaskSideEffectRow): TaskSideEffect {
    return {
      id: row.id,
      ticketId: row.ticket_id,
      attemptId: row.attempt_id ?? undefined,
      correlationId: row.correlation_id ?? undefined,
      type: row.effect_type,
      payload: JSON.parse(row.payload_json) as Record<string, unknown>,
      status: row.status,
      idempotencyKey: row.idempotency_key,
      createdAt: new Date(row.created_at),
      processedAt: row.processed_at ? new Date(row.processed_at) : undefined,
      lastError: row.last_error ?? undefined,
    };
  }

  private mapWorkerVersionRow(row: WorkerVersionRow): WorkerVersion {
    return {
      id: row.id,
      attemptId: row.attempt_id,
      workspaceId: row.workspace_id ?? undefined,
      workspaceRoot: row.workspace_root ?? undefined,
      patchBundlePath: row.patch_bundle_path ?? undefined,
      verificationSummary: row.verification_summary ?? undefined,
      createdAt: new Date(row.created_at),
      activatedAt: row.activated_at ? new Date(row.activated_at) : undefined,
      status: row.status,
    };
  }

  private mapPromotionRecordRow(row: PromotionRecordRow): PromotionRecord {
    return {
      id: row.id,
      workerVersionId: row.worker_version_id,
      status: row.status,
      requestedAt: new Date(row.requested_at),
      updatedAt: new Date(row.updated_at),
      approvedBy: row.approved_by ?? undefined,
      approvalId: row.approval_id ?? undefined,
      failureReason: row.failure_reason ?? undefined,
      rollbackReason: row.rollback_reason ?? undefined,
    };
  }

  private recordPromotionLifecycleEvent(row: PromotionRecordRow): void {
    const ticketId = this.getTicketIdForWorkerVersion(row.worker_version_id);
    if (!ticketId) {
      return;
    }

    this.recordEvent({
      ticketId,
      type: resolvePromotionEvent(row.status),
      createdAt: new Date(row.updated_at),
      details: `${row.id}:${row.status}`,
      correlationId: row.approval_id ?? undefined,
      evidence: {
        promotionId: row.id,
        workerVersionId: row.worker_version_id,
        promotionStatus: row.status,
        approvedBy: row.approved_by ?? undefined,
        approvalId: row.approval_id ?? undefined,
        failureReason: row.failure_reason ?? undefined,
        rollbackReason: row.rollback_reason ?? undefined,
      },
    });
  }

  private getTicketIdForWorkerVersion(workerVersionId: string): string | null {
    const row = this.getDatabase()
      .prepare(
        `select ta.ticket_id as ticket_id
         from worker_versions wv
         join ticket_attempts ta on ta.id = wv.attempt_id
         where wv.id = ?`
      )
      .get(workerVersionId) as { ticket_id: string } | undefined;

    return row?.ticket_id ?? null;
  }

  private recordEvent(event: TaskEvent): void {
    const db = this.getDatabase();
    const createdAt = event.createdAt.toISOString();
    const serializedEvidence = serializeEventEvidence(event.evidence);
    const legacyInsert = db
      .prepare(
        `insert into ticket_events (ticket_id, event_type, details, evidence_json, correlation_id, created_at)
         values (?, ?, ?, ?, ?, ?)`
      )
      .run(
        event.ticketId,
        event.type,
        event.details ?? null,
        serializedEvidence,
        event.correlationId ?? null,
        createdAt
      ) as { lastInsertRowid?: number | bigint };

    const domainEventId = this.generateDomainEventId();
    const legacyEventId =
      typeof legacyInsert.lastInsertRowid === 'bigint'
        ? Number(legacyInsert.lastInsertRowid)
        : legacyInsert.lastInsertRowid;
    const legacyEventIdNumber =
      typeof legacyEventId === 'number' && Number.isFinite(legacyEventId)
        ? legacyEventId
        : null;

    db.prepare(
      `insert into domain_events (
        id,
        ticket_id,
        event_type,
        details,
        evidence_json,
        correlation_id,
        legacy_event_id,
        created_at
      )
      values (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      domainEventId,
      event.ticketId,
      event.type,
      event.details ?? null,
      serializedEvidence,
      event.correlationId ?? null,
      legacyEventIdNumber,
      createdAt
    );

    const evidenceRows = toEventEvidenceRows({
      id: domainEventId,
      ticket_id: event.ticketId,
      event_type: event.type,
      details: event.details ?? null,
      evidence_json: serializedEvidence,
      correlation_id: event.correlationId ?? null,
      legacy_event_id: legacyEventIdNumber,
      created_at: createdAt,
    });

    if (evidenceRows.length === 0) {
      return;
    }

    const insertEvidence = db.prepare(
      `insert into event_evidence (
        domain_event_id,
        ticket_id,
        evidence_key,
        evidence_value_json,
        created_at
      )
      values (?, ?, ?, ?, ?)`
    );

    for (const row of evidenceRows) {
      insertEvidence.run(
        row.domain_event_id,
        row.ticket_id,
        row.evidence_key,
        row.evidence_value_json,
        row.created_at
      );
    }
  }

  private async readTaskBoard(): Promise<string> {
    try {
      return await fs.readFile(this.tasksFile, 'utf-8');
    } catch (error) {
      const errorCode = (error as NodeJS.ErrnoException).code;
      if (errorCode === 'ENOENT') {
        return renderTaskBoard([]);
      }

      throw error;
    }
  }

  private async writeProjectionSafely(force = false): Promise<void> {
    if (!this.projectionEnabled || this.usingFallback || !this.db) {
      return;
    }

    if (!force && this.projectionWriteInProgress) {
      this.projectionWriteQueued = true;
      return;
    }

    if (!force && this.projectionMinWriteIntervalMs > 0) {
      const elapsedMs = Date.now() - this.lastProjectionWriteAtMs;
      const waitMs = this.projectionMinWriteIntervalMs - elapsedMs;
      if (waitMs > 0) {
        if (!this.projectionFlushTimer) {
          this.projectionFlushTimer = setTimeout(() => {
            this.projectionFlushTimer = null;
            void this.writeProjectionSafely();
          }, waitMs);
        }
        return;
      }
    }

    this.projectionWriteInProgress = true;

    try {
      const board = renderTaskBoard(this.listAllTasks());
      await this.projectionWriter(this.tasksFile, board);
      this.lastProjectionWriteAtMs = Date.now();
      this.clearProjectionFailureState();

      if (this.db) {
        try {
          this.recordEvent({
            ticketId: 'board',
            type: 'board-synced',
            createdAt: new Date(),
            details: formatTaskBoardTicketComment('projection'),
          });
        } catch (error) {
          logger.warn('Projected TASKS.md write succeeded, but board sync event could not be recorded.', {
            error: error instanceof Error ? error.message : String(error),
            tasksFile: this.tasksFile,
          });
        }
      }
    } catch (error) {
      if (!this.db) {
        return;
      }

      this.projectionLastError = error instanceof Error ? error.message : String(error);
      this.projectionConsecutiveFailures += 1;
      logger.error('Error writing projected TASKS.md', {
        error: this.projectionLastError,
        tasksFile: this.tasksFile,
        consecutiveFailures: this.projectionConsecutiveFailures,
        forced: force,
      });
      this.scheduleProjectionRetry();
    } finally {
      this.projectionWriteInProgress = false;
      if (this.projectionWriteQueued) {
        this.projectionWriteQueued = false;
        void this.writeProjectionSafely();
      }
    }
  }

  private clearProjectionFailureState(): void {
    this.projectionLastError = null;
    this.projectionConsecutiveFailures = 0;
    this.projectionNextRetryDelayMs = this.projectionRetryDelayMs;

    if (this.projectionRetryTimer) {
      clearTimeout(this.projectionRetryTimer);
      this.projectionRetryTimer = null;
    }

    if (this.projectionFlushTimer) {
      clearTimeout(this.projectionFlushTimer);
      this.projectionFlushTimer = null;
    }

    this.projectionScheduledRetryDelayMs = null;
  }

  private scheduleProjectionRetry(): void {
    if (this.projectionRetryTimer) {
      logger.warn('TASKS.md projection remains unhealthy; existing retry schedule will be reused.', {
        tasksFile: this.tasksFile,
        nextRetryDelayMs: this.projectionScheduledRetryDelayMs,
      });
      return;
    }

    const retryDelayMs = this.projectionNextRetryDelayMs;
    this.projectionScheduledRetryDelayMs = retryDelayMs;
    this.projectionRetryTimer = setTimeout(() => {
      this.projectionRetryTimer = null;
      this.projectionScheduledRetryDelayMs = null;
      void this.writeProjectionSafely(true);
    }, retryDelayMs);

    logger.warn('TASKS.md projection unhealthy; retry scheduled.', {
      tasksFile: this.tasksFile,
      retryDelayMs,
      error: this.projectionLastError,
      consecutiveFailures: this.projectionConsecutiveFailures,
    });

    this.projectionNextRetryDelayMs = Math.min(
      this.projectionNextRetryDelayMs * 2,
      this.projectionRetryMaxDelayMs
    );
  }

  private getDatabase(): DatabaseSync {
    if (!this.db) {
      throw new Error('Ticket store database is not initialized.');
    }

    return this.db;
  }

  private generateTicketId(): string {
    return `ticket_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  }

  private generateAttemptId(): string {
    return `attempt_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  }

  private generateSideEffectId(): string {
    return `effect_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  }

  private generateDomainEventId(): string {
    return `event_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  }

  private generateWorkerVersionId(): string {
    return `worker_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  }

  private generatePromotionRecordId(): string {
    return `promotion_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  }
}

function createDescriptionKey(description: string): string {
  return normalizeTaskDescription(description).toLowerCase();
}

function normalizeProjectionForComparison(content: string): string {
  return content.replace(/\r\n/g, '\n').trim();
}

function parseTimestampMs(value: string | null | undefined): number {
  if (!value) {
    return 0;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clampPositiveInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, Math.floor(value)));
}

function buildTicketCounts(tickets: TaskTicket[]): Record<string, number> {
  const counts: Record<string, number> = { total: tickets.length };
  for (const ticket of tickets) {
    counts[ticket.status] = (counts[ticket.status] ?? 0) + 1;
  }

  return counts;
}

function serializeToolCalls(toolCalls: ToolCall[] | undefined): string | null {
  return toolCalls && toolCalls.length > 0 ? JSON.stringify(toolCalls) : null;
}

function serializeEventEvidence(evidence: Record<string, unknown> | undefined): string | null {
  if (!evidence || Object.keys(evidence).length === 0) {
    return null;
  }

  return JSON.stringify(evidence);
}

function parseEventEvidence(raw: string | null): Record<string, unknown> | undefined {
  if (!raw) {
    return undefined;
  }

  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return undefined;
  }

  return parsed as Record<string, unknown>;
}

function toEventEvidenceRows(event: DomainEventRow): EventEvidenceRow[] {
  const evidence = parseEventEvidence(event.evidence_json);
  if (!evidence) {
    return [];
  }

  const rows: EventEvidenceRow[] = [];
  for (const [key, value] of Object.entries(evidence)) {
    const serialized = serializeEvidenceValue(value);
    if (!serialized) {
      continue;
    }

    rows.push({
      domain_event_id: event.id,
      ticket_id: event.ticket_id,
      evidence_key: key,
      evidence_value_json: serialized,
      created_at: event.created_at,
    });
  }

  return rows;
}

function serializeEvidenceValue(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return JSON.stringify(value);
}

function parseToolCalls(raw: string | null): ToolCall[] | undefined {
  if (!raw) {
    return undefined;
  }

  return JSON.parse(raw) as ToolCall[];
}

function serializeApprovalState(approval: TaskApprovalState | undefined): string | null {
  if (!approval) {
    return null;
  }

  return JSON.stringify({
    ...approval,
    requestedAt: approval.requestedAt.toISOString(),
    decisionAt: approval.decisionAt?.toISOString(),
  });
}

function parseApprovalState(raw: string | null): TaskApprovalState | undefined {
  if (!raw) {
    return undefined;
  }

  const parsed = JSON.parse(raw) as Omit<TaskApprovalState, 'requestedAt' | 'decisionAt'> & {
    requestedAt: string;
    decisionAt?: string;
  };

  return {
    ...parsed,
    requestedAt: new Date(parsed.requestedAt),
    decisionAt: parsed.decisionAt ? new Date(parsed.decisionAt) : undefined,
  };
}

function requireApprovalState(
  ticket: TaskTicket,
  expectedStatus: TaskApprovalState['status'],
  action: 'approve' | 'reject' | 'resume'
): TaskApprovalState {
  if (ticket.status !== 'awaiting_approval') {
    throw new Error(
      `Only awaiting approval tickets can be ${action}d. Current status: ${ticket.status}`
    );
  }

  if (!ticket.approval) {
    throw new Error(`Ticket ${ticket.id} does not have a persisted approval request to ${action}.`);
  }

  if (ticket.approval.status !== expectedStatus) {
    throw new Error(
      `Ticket ${ticket.id} approval must be ${expectedStatus} to ${action}. Current approval status: ${ticket.approval.status}`
    );
  }

  return ticket.approval;
}

function formatApprovalEventDetails(approval: TaskApprovalState): string {
  return JSON.stringify({
    requestId: approval.requestId,
    status: approval.status,
    reviewer: approval.reviewer,
    rationale: approval.rationale,
    approvalId: approval.approvalId,
    requestedReason: approval.requestedReason,
    touchedPaths: approval.touchedPaths,
    changedLines: approval.changedLines,
    requestedAt: approval.requestedAt.toISOString(),
    decisionAt: approval.decisionAt?.toISOString(),
  });
}
