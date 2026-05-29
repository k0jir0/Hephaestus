import type { Task, TaskSideEffect, TaskSideEffectType } from './types.js';

export interface RepositoryReadinessIssue {
  code: string;
  message: string;
  blocking: boolean;
}

export interface RepositoryReadinessProbe {
  getRepositoryReadiness(): Promise<RepositoryReadinessIssue[]>;
}

export interface ToolRuntimeReadinessProbe {
  checkReadiness(): Promise<{ available: boolean; message: string }>;
}

export interface PendingTaskSideEffect {
  type: TaskSideEffectType;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  correlationId?: string;
  attemptId?: string;
}

export interface TaskSideEffectRepository {
  enqueueTaskSideEffects(ticketId: string, sideEffects: PendingTaskSideEffect[]): Promise<TaskSideEffect[]>;
  markTaskSideEffectProcessed(id: string): Promise<void>;
  markTaskSideEffectFailed(id: string, error: string): Promise<void>;
  listTaskSideEffects(ticketId?: string): Promise<TaskSideEffect[]>;
}

export interface TaskArtifactRepository {
  appendTaskAttemptArtifacts(ticketId: string, artifacts: string[]): Promise<void>;
}

export interface TaskRepository {
  start(callback: (task: Task) => Promise<void> | void): Promise<void>;
  stop(): Promise<void>;
  getPendingTasks(): Promise<Task[]>;
  markTaskInProgress(task: Task): Promise<void>;
  markTaskAwaitingApproval(task: Task): Promise<void>;
  markTaskCompleted(task: Task): Promise<void>;
  markTaskFailed(task: Task): Promise<void>;
  markTaskBlocked(task: Task): Promise<void>;
}

export interface MemoryRepository {
  initialize(): Promise<void>;
  updateStatus(status: string, task?: string): Promise<void>;
  recordTaskCompletion(task: Task, result: string): Promise<void>;
  recordBlocker(blocker: string, resolution?: string): Promise<void>;
  addToTaskHistory(task: Task, result: string): Promise<void>;
  addSessionSummary(summary: string): Promise<void>;
}
