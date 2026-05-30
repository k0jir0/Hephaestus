import type {
  PromotionEventType,
  PromotionRecord,
  PromotionStatus,
  WorkerVersion,
  WorkerVersionStatus,
} from '../../types.js';

export const allowedPromotionTransitions: Record<PromotionStatus, readonly PromotionStatus[]> = {
  requested: ['verified', 'failed'],
  verified: ['started', 'failed'],
  started: ['health_check_passed', 'failed'],
  health_check_passed: ['completed', 'failed'],
  completed: [],
  failed: ['rolled_back'],
  rolled_back: [],
};

export const promotionEventByStatus: Record<PromotionStatus, PromotionEventType> = {
  requested: 'promotion.requested',
  verified: 'promotion.verified',
  started: 'promotion.started',
  health_check_passed: 'promotion.health_check_passed',
  completed: 'promotion.completed',
  failed: 'promotion.failed',
  rolled_back: 'promotion.rolled_back',
};

export const allowedWorkerVersionTransitions: Record<WorkerVersionStatus, readonly WorkerVersionStatus[]> = {
  candidate: ['promotable', 'rolled_back'],
  promotable: ['active', 'rolled_back'],
  active: ['rolled_back'],
  rolled_back: [],
};

export function canTransitionPromotionStatus(current: PromotionStatus, next: PromotionStatus): boolean {
  return current === next || allowedPromotionTransitions[current].includes(next);
}

export function canTransitionWorkerVersionStatus(
  current: WorkerVersionStatus,
  next: WorkerVersionStatus
): boolean {
  return current === next || allowedWorkerVersionTransitions[current].includes(next);
}

export function assertValidPromotionTransition(
  current: PromotionStatus,
  next: PromotionStatus,
  context: string
): void {
  if (!canTransitionPromotionStatus(current, next)) {
    throw new Error(`Invalid promotion transition in ${context}: ${current} -> ${next}`);
  }
}

export function assertValidWorkerVersionTransition(
  current: WorkerVersionStatus,
  next: WorkerVersionStatus,
  context: string
): void {
  if (!canTransitionWorkerVersionStatus(current, next)) {
    throw new Error(`Invalid worker version transition in ${context}: ${current} -> ${next}`);
  }
}

export function transitionPromotion(
  promotion: PromotionRecord,
  nextStatus: PromotionStatus,
  at = new Date()
): PromotionRecord {
  assertValidPromotionTransition(promotion.status, nextStatus, `promotion ${promotion.id}`);

  return {
    ...promotion,
    status: nextStatus,
    updatedAt: at,
  };
}

export function transitionWorkerVersion(
  workerVersion: WorkerVersion,
  nextStatus: WorkerVersionStatus,
  at = new Date()
): WorkerVersion {
  assertValidWorkerVersionTransition(workerVersion.status, nextStatus, `workerVersion ${workerVersion.id}`);

  return {
    ...workerVersion,
    status: nextStatus,
    activatedAt: nextStatus === 'active' ? workerVersion.activatedAt ?? at : workerVersion.activatedAt,
  };
}

export function resolvePromotionEvent(status: PromotionStatus): PromotionEventType {
  return promotionEventByStatus[status];
}
