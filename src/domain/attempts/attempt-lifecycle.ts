import type { TaskAttempt, TaskAttemptStatus } from '../../types.js';

export const allowedAttemptTransitions: Record<TaskAttemptStatus, readonly TaskAttemptStatus[]> = {
  in_progress: ['awaiting_approval', 'completed', 'blocked', 'failed', 'stale', 'cancelled'],
  awaiting_approval: ['blocked', 'cancelled'],
  completed: [],
  blocked: [],
  failed: [],
  stale: [],
  cancelled: [],
};

export function canTransitionTaskAttemptStatus(
  current: TaskAttemptStatus,
  next: TaskAttemptStatus
): boolean {
  return current === next || allowedAttemptTransitions[current].includes(next);
}

export function assertValidTaskAttemptTransition(
  current: TaskAttemptStatus,
  next: TaskAttemptStatus,
  context: string
): void {
  if (!canTransitionTaskAttemptStatus(current, next)) {
    throw new Error(`Invalid task attempt transition in ${context}: ${current} -> ${next}`);
  }
}

export function transitionTaskAttempt(
  attempt: TaskAttempt,
  nextStatus: TaskAttemptStatus,
  at = new Date()
): TaskAttempt {
  assertValidTaskAttemptTransition(attempt.status, nextStatus, `attempt ${attempt.id}`);

  return {
    ...attempt,
    status: nextStatus,
    endedAt: nextStatus === 'in_progress' ? attempt.endedAt : attempt.endedAt ?? at,
  };
}

export function settleTaskAttemptStatus(
  attempt: TaskAttempt,
  nextStatus: TaskAttemptStatus,
  at = new Date()
): TaskAttempt {
  if (canTransitionTaskAttemptStatus(attempt.status, nextStatus)) {
    return transitionTaskAttempt(attempt, nextStatus, at);
  }

  return {
    ...attempt,
    status: nextStatus,
    endedAt: nextStatus === 'in_progress' ? attempt.endedAt : attempt.endedAt ?? at,
  };
}

export function resolveTaskAttemptStatusTransition(
  current: TaskAttemptStatus,
  next: TaskAttemptStatus,
  context: string
): TaskAttemptStatus {
  assertValidTaskAttemptTransition(current, next, context);
  return next;
}
