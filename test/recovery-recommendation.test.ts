import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { deriveRecoveryRecommendation } from '../src/recovery-recommendation.js';
import type { TaskAttempt, TaskTicket } from '../src/types.js';

function makeTicket(error?: string): TaskTicket {
  return {
    id: 'ticket_demo',
    description: 'Fix a failing test',
    status: error ? 'blocked' : 'pending',
    createdAt: new Date('2026-05-27T00:00:00.000Z'),
    updatedAt: new Date('2026-05-27T00:00:00.000Z'),
    attemptCount: 1,
    sourceOrder: 1,
    error,
  };
}

function makeAttempt(artifact: string): TaskAttempt {
  return {
    id: 'attempt_demo',
    ticketId: 'ticket_demo',
    attemptNumber: 1,
    status: 'blocked',
    startedAt: new Date('2026-05-27T00:00:00.000Z'),
    endedAt: new Date('2026-05-27T00:01:00.000Z'),
    artifacts: [artifact],
  };
}

describe('deriveRecoveryRecommendation', () => {
  it('prefers durable classification artifacts over raw ticket errors', () => {
    const recommendation = deriveRecoveryRecommendation(
      makeTicket('Command failed: npm test'),
      [
        makeAttempt(
          '[blocked_ticket_demo] failure.classification planner; retryable=true; recommendation=Retry with a narrower prompt.'
        ),
      ]
    );

    assert.equal(recommendation.family, 'planner');
    assert.equal(recommendation.retryable, true);
    assert.equal(recommendation.source, 'artifact');
    assert.match(recommendation.recommendation, /narrower prompt/);
  });

  it('falls back to classifying the visible ticket error', () => {
    const recommendation = deriveRecoveryRecommendation(
      makeTicket('Command failed: npm test'),
      []
    );

    assert.equal(recommendation.family, 'verification');
    assert.equal(recommendation.source, 'ticket-error');
    assert.match(recommendation.recommendation, /amended plan/);
  });
});
