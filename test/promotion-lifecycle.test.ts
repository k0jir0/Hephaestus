import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assertValidPromotionTransition,
  assertValidWorkerVersionTransition,
  resolvePromotionEvent,
  transitionPromotion,
  transitionWorkerVersion,
} from '../src/domain/promotion/promotion-lifecycle.js';
import type { PromotionRecord, WorkerVersion } from '../src/types.js';

function makePromotion(status: PromotionRecord['status']): PromotionRecord {
  const now = new Date();
  return {
    id: 'promotion_001',
    workerVersionId: 'worker_001',
    status,
    requestedAt: now,
    updatedAt: now,
  };
}

function makeWorkerVersion(status: WorkerVersion['status']): WorkerVersion {
  return {
    id: 'worker_001',
    attemptId: 'attempt_001',
    createdAt: new Date(),
    status,
  };
}

describe('promotion lifecycle', () => {
  it('allows expected promotion transitions and emits matching events', () => {
    const verified = transitionPromotion(makePromotion('requested'), 'verified');
    const started = transitionPromotion(verified, 'started');
    const healthChecked = transitionPromotion(started, 'health_check_passed');
    const completed = transitionPromotion(healthChecked, 'completed');

    assert.equal(verified.status, 'verified');
    assert.equal(started.status, 'started');
    assert.equal(healthChecked.status, 'health_check_passed');
    assert.equal(completed.status, 'completed');
    assert.equal(resolvePromotionEvent(completed.status), 'promotion.completed');
  });

  it('allows failed promotions to roll back', () => {
    const failed = transitionPromotion(makePromotion('started'), 'failed');
    const rolledBack = transitionPromotion(failed, 'rolled_back');

    assert.equal(failed.status, 'failed');
    assert.equal(rolledBack.status, 'rolled_back');
    assert.equal(resolvePromotionEvent(rolledBack.status), 'promotion.rolled_back');
  });

  it('rejects invalid promotion transitions', () => {
    assert.throws(
      () => assertValidPromotionTransition('requested', 'completed', 'unit-test'),
      /Invalid promotion transition/
    );
  });

  it('enforces worker version transitions and activation timestamping', () => {
    const promotable = transitionWorkerVersion(makeWorkerVersion('candidate'), 'promotable');
    const active = transitionWorkerVersion(promotable, 'active');

    assert.equal(promotable.status, 'promotable');
    assert.equal(active.status, 'active');
    assert.ok(active.activatedAt instanceof Date);
  });

  it('rejects invalid worker version transitions', () => {
    assert.throws(
      () => assertValidWorkerVersionTransition('candidate', 'active', 'unit-test'),
      /Invalid worker version transition/
    );
  });
});
