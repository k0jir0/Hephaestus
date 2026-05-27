import type { Task, TaskStatus } from './types.js';

const allowedTransitions: Record<TaskStatus, readonly TaskStatus[]> = {
  pending: ['in_progress', 'blocked', 'cancelled'],
  in_progress: ['planned', 'awaiting_approval', 'applying', 'verifying', 'completed', 'blocked', 'cancelled'],
  planned: ['awaiting_approval', 'applying', 'verifying', 'completed', 'blocked', 'cancelled'],
  awaiting_approval: ['pending', 'applying', 'verifying', 'completed', 'blocked', 'cancelled'],
  applying: ['verifying', 'completed', 'blocked', 'cancelled'],
  verifying: ['completed', 'blocked', 'cancelled'],
  completed: ['merged'],
  merged: [],
  blocked: ['pending', 'cancelled'],
  failed: ['pending', 'cancelled'],
  cancelled: ['pending'],
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
    blockedAt: nextStatus === 'blocked' ? at : task.blockedAt,
    cancelledAt: nextStatus === 'cancelled' ? at : task.cancelledAt,
  };
}