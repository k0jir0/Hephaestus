import type { Task, TaskStatus } from './types.js';

const allowedTransitions: Record<TaskStatus, readonly TaskStatus[]> = {
  pending: ['in_progress', 'blocked', 'cancelled', 'superseded'],
  in_progress: ['planned', 'awaiting_approval', 'applying', 'verifying', 'completed', 'failed', 'blocked', 'stale', 'cancelled', 'superseded'],
  planned: ['awaiting_approval', 'applying', 'verifying', 'completed', 'failed', 'blocked', 'stale', 'cancelled', 'superseded'],
  awaiting_approval: ['pending', 'applying', 'verifying', 'completed', 'failed', 'blocked', 'cancelled', 'superseded'],
  applying: ['verifying', 'completed', 'failed', 'blocked', 'stale', 'cancelled', 'superseded'],
  verifying: ['completed', 'failed', 'blocked', 'stale', 'cancelled', 'superseded'],
  completed: ['merged'],
  merged: [],
  blocked: ['pending', 'cancelled', 'superseded'],
  failed: ['pending', 'cancelled', 'superseded'],
  stale: ['pending', 'blocked', 'cancelled', 'superseded'],
  cancelled: ['pending', 'superseded'],
  superseded: [],
};

export function canTransitionTaskStatus(current: TaskStatus, next: TaskStatus): boolean {
  return current === next || allowedTransitions[current].includes(next);
}

export function assertValidTaskTransition(
  current: TaskStatus,
  next: TaskStatus,
  context: string
): void {
  if (!canTransitionTaskStatus(current, next)) {
    throw new Error(`Invalid task transition in ${context}: ${current} -> ${next}`);
  }
}

export function transitionTask(task: Task, nextStatus: TaskStatus, at = new Date()): Task {
  assertValidTaskTransition(task.status, nextStatus, `task ${task.id}`);

  return {
    ...task,
    status: nextStatus,
    updatedAt: at,
    startedAt: nextStatus === 'in_progress' ? task.startedAt ?? at : task.startedAt,
    completedAt: nextStatus === 'completed' ? at : task.completedAt,
    blockedAt: nextStatus === 'blocked' || nextStatus === 'stale' ? at : task.blockedAt,
    cancelledAt: nextStatus === 'cancelled' || nextStatus === 'superseded' ? at : task.cancelledAt,
  };
}
