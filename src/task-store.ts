import fs from 'fs/promises';
import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { createComponentLogger } from './logger.js';
import type {
  PendingTaskSideEffect,
  TaskArtifactRepository,
  RepositoryReadinessProbe,
  TaskRepository,
  TaskSideEffectRepository,
} from './repositories.js';
import { assertValidTaskTransition } from './task-lifecycle.js';
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
  TaskSideEffect,
  TaskSideEffectStatus,
  TaskStatus,
  TaskTicket,
  ToolCall,
} from './types.js';
import { TaskWatcher } from './watcher.js';

const logger = createComponentLogger('TaskStore');

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
  projectionRetryDelayMs?: number;
  projectionRetryMaxDelayMs?: number;
  projectionWriter?: (tasksFile: string, content: string) => Promise<void>;
}

export interface ProjectionHealthStatus {
  healthy: boolean;
  lastError?: string;
  retryScheduled: boolean;
  nextRetryDelayMs?: number;
  consecutiveFailures: number;
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
  correlation_id: string | null;
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

export class TicketStoreRepository
  implements TaskRepository, RepositoryReadinessProbe, TaskSideEffectRepository, TaskArtifactRepository
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
  private readonly projectionRetryDelayMs: number;
  private readonly projectionRetryMaxDelayMs: number;
  private readonly projectionWriter: (tasksFile: string, content: string) => Promise<void>;
  private readonly knownPendingTaskIds = new Set<string>();
  private readonly pendingRedispatchAfter = new Map<string, number>();
  private readonly pendingDispatchInFlight = new Set<string>();
  private pendingPollTimer: NodeJS.Timeout | null = null;
  private projectionRetryTimer: NodeJS.Timeout | null = null;
  private projectionScheduledRetryDelayMs: number | null = null;
  private projectionLastError: string | null = null;
  private projectionConsecutiveFailures = 0;
  private projectionNextRetryDelayMs = 0;
  private onNewTask: ((task: Task) => Promise<void>) | null = null;
  private db: DatabaseSync | null = null;
  private initialization: Promise<void> | null = null;
  private usingFallback = false;
  private dispatchInProgress = false;

  constructor(options: TicketStoreRepositoryOptions = {}) {
    this.tasksFile = options.tasksFile ?? config.tasksFile;
    this.storeFile = options.storeFile ?? config.ticketStoreFile;
    this.forceMarkdownFallback = options.forceMarkdownFallback ?? false;
    this.allowMarkdownFallback = options.allowMarkdownFallback ?? false;
    this.importLegacyTaskBoardIfStoreEmpty =
      options.importLegacyTaskBoardIfStoreEmpty ?? true;
    this.projectionEnabled = options.projectionEnabled ?? true;
    this.pollingIntervalMs = options.pollingIntervalMs ?? 1000;
    this.redispatchPendingAfterMs = options.redispatchPendingAfterMs ?? 60_000;
    this.projectionRetryDelayMs = options.projectionRetryDelayMs ?? 1_000;
    this.projectionRetryMaxDelayMs = options.projectionRetryMaxDelayMs ?? 30_000;
    this.projectionWriter = options.projectionWriter ?? ((tasksFile, content) =>
      fs.writeFile(tasksFile, content, 'utf-8')
    );
    this.projectionNextRetryDelayMs = this.projectionRetryDelayMs;
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

    if (!this.pendingPollTimer) {
      this.pendingPollTimer = setInterval(() => {
        void this.dispatchPendingTasks();
      }, this.pollingIntervalMs);
    }
  }

  async stop(): Promise<void> {
    if (this.pendingPollTimer) {
      clearInterval(this.pendingPollTimer);
      this.pendingPollTimer = null;
    }

    if (this.projectionRetryTimer) {
      clearTimeout(this.projectionRetryTimer);
      this.projectionRetryTimer = null;
      this.projectionScheduledRetryDelayMs = null;
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
    const attemptNumber = ticket.attempt_count + 1;
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
             approval_json = coalesce(?, approval_json)
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
             approval_json = coalesce(?, approval_json)
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

    const rows = (
      ticketId
        ? this.getDatabase()
            .prepare(
              `select ticket_id, event_type, details, correlation_id, created_at
               from ticket_events
               where ticket_id = ?
               order by created_at asc, id asc`
            )
            .all(ticketId)
        : this.getDatabase()
            .prepare(
              `select ticket_id, event_type, details, correlation_id, created_at
               from ticket_events
               order by created_at asc, id asc`
            )
            .all()
    ) as unknown as TicketEventRow[];

    return rows.map((row) => ({
      ticketId: row.ticket_id,
      type: row.event_type,
      details: row.details ?? undefined,
      correlationId: row.correlation_id ?? undefined,
      createdAt: new Date(row.created_at),
    }));
  }

  async retryTicket(ticketId: string): Promise<TaskTicket> {
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

    if (ticket.status !== 'blocked' && ticket.status !== 'failed' && ticket.status !== 'cancelled') {
      throw new Error(`Only blocked, failed, or cancelled tickets can be retried. Current status: ${ticket.status}`);
    }

    assertValidTaskTransition(ticket.status, 'pending', `ticket ${ticket.id}`);

    const now = new Date().toISOString();
    this.getDatabase()
      .prepare(
        `update tickets
         set status = 'pending',
             updated_at = ?,
             blocked_at = null,
             cancelled_at = null,
             error = null,
             current_attempt_id = null,
             source_order = ?
         where id = ?`
      )
      .run(now, this.getNextSourceOrder(), ticketId);

    this.recordEvent({
      ticketId,
      type: 'requeued',
      createdAt: new Date(now),
      details: 'Retry requested through the operator interface.',
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

    if (!ticket.plan) {
      throw new Error(`Ticket ${ticket.id} does not have a persisted plan to resume.`);
    }

    if (!ticket.toolCalls || ticket.toolCalls.length === 0) {
      throw new Error(`Ticket ${ticket.id} does not have persisted tool calls to resume.`);
    }

    if (!ticket.toolCalls.some((toolCall) => toolCall.name === 'patch.apply')) {
      throw new Error(`Ticket ${ticket.id} does not contain a resumable patch.apply tool call.`);
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
          correlation_id text,
          created_at text not null
        );

        create index if not exists idx_ticket_events_ticket_created
          on ticket_events(ticket_id, created_at);

        create table if not exists ticket_attempts (
          id text primary key,
          ticket_id text not null,
          attempt_number integer not null,
          status text not null,
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

    const attemptColumns = db.prepare('pragma table_info(ticket_attempts)').all() as Array<{ name: string }>;
    const attemptColumnNames = new Set(attemptColumns.map((column) => column.name));
    if (!attemptColumnNames.has('tool_calls_json')) {
      db.exec('alter table ticket_attempts add column tool_calls_json text;');
    }

    if (!attemptColumnNames.has('approval_json')) {
      db.exec('alter table ticket_attempts add column approval_json text;');
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
  }

  private async dispatchPendingTasks(): Promise<void> {
    if (this.dispatchInProgress) {
      return;
    }

    this.dispatchInProgress = true;
    try {
      const tasks = this.listTasksByStatus('pending');
      const now = Date.now();
      const newTasks = tasks.filter((task) => {
        if (this.pendingDispatchInFlight.has(task.id)) {
          return false;
        }

        if (!this.knownPendingTaskIds.has(task.id)) {
          return true;
        }

        return (this.pendingRedispatchAfter.get(task.id) ?? Number.POSITIVE_INFINITY) <= now;
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
          this.pendingRedispatchAfter.set(task.id, Date.now() + this.redispatchPendingAfterMs);
        } else {
          this.pendingRedispatchAfter.delete(task.id);
        }
      }
    } finally {
      this.dispatchInProgress = false;
    }
  }

  private insertTicket(input: {
    id: string;
    description: string;
    status: TaskStatus;
    sourceOrder: number;
  }): void {
    const now = new Date().toISOString();
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
    });
  }

  private insertAttempt(input: {
    id: string;
    ticketId: string;
    attemptNumber: number;
    status: TaskAttemptStatus;
    startedAt: string;
  }): void {
    this.getDatabase()
      .prepare(
        `insert into ticket_attempts (
          id,
          ticket_id,
          attempt_number,
          status,
          started_at,
          artifacts_json
        ) values (?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.id,
        input.ticketId,
        input.attemptNumber,
        input.status,
        input.startedAt,
        JSON.stringify([])
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
    const attemptId = ticket.current_attempt_id ?? this.getLatestAttemptId(ticket.id);
    if (!attemptId) {
      return;
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

  private recordEvent(event: TaskEvent): void {
    this.getDatabase()
      .prepare(
        `insert into ticket_events (ticket_id, event_type, details, correlation_id, created_at)
         values (?, ?, ?, ?, ?)`
      )
      .run(
        event.ticketId,
        event.type,
        event.details ?? null,
        event.correlationId ?? null,
        event.createdAt.toISOString()
      );
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

    try {
      const board = renderTaskBoard(this.listAllTasks());
      await this.projectionWriter(this.tasksFile, board);
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
}

function createDescriptionKey(description: string): string {
  return normalizeTaskDescription(description).toLowerCase();
}

function serializeToolCalls(toolCalls: ToolCall[] | undefined): string | null {
  return toolCalls && toolCalls.length > 0 ? JSON.stringify(toolCalls) : null;
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
