import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildUpgradeTelemetrySnapshot } from '../src/upgrade-telemetry.js';
import type { TaskAttempt, TaskTicket } from '../src/types.js';

describe('upgrade telemetry snapshot', () => {
  it('computes queue, churn, and policy telemetry with actionable alerts', () => {
    const now = new Date('2026-05-29T12:00:00.000Z').getTime();

    const tickets: TaskTicket[] = [
      {
        id: 'ticket_1',
        description: 'pending old',
        status: 'pending',
        createdAt: new Date('2026-05-20T12:00:00.000Z'),
        updatedAt: new Date('2026-05-20T12:00:00.000Z'),
        attemptCount: 0,
        sourceOrder: 1,
      },
      {
        id: 'ticket_2',
        description: 'pending recent',
        status: 'pending',
        createdAt: new Date('2026-05-29T08:00:00.000Z'),
        updatedAt: new Date('2026-05-29T08:00:00.000Z'),
        attemptCount: 1,
        sourceOrder: 2,
        startedAt: new Date('2026-05-29T08:10:00.000Z'),
      },
      {
        id: 'ticket_3',
        description: 'superseded ticket',
        status: 'superseded',
        createdAt: new Date('2026-05-29T09:00:00.000Z'),
        updatedAt: new Date('2026-05-29T09:30:00.000Z'),
        attemptCount: 1,
        sourceOrder: 3,
      },
      {
        id: 'ticket_4',
        description: 'completed ticket',
        status: 'completed',
        createdAt: new Date('2026-05-29T09:00:00.000Z'),
        updatedAt: new Date('2026-05-29T09:40:00.000Z'),
        attemptCount: 2,
        sourceOrder: 4,
        startedAt: new Date('2026-05-29T09:10:00.000Z'),
        completedAt: new Date('2026-05-29T09:40:00.000Z'),
      },
    ];

    const attempts: TaskAttempt[] = [
      {
        id: 'attempt_1',
        ticketId: 'ticket_4',
        attemptNumber: 1,
        status: 'failed',
        startedAt: new Date('2026-05-29T09:10:00.000Z'),
        endedAt: new Date('2026-05-29T09:20:00.000Z'),
        error: 'Command is not allowlisted: npm run weird',
        artifacts: [],
      },
      {
        id: 'attempt_2',
        ticketId: 'ticket_4',
        attemptNumber: 2,
        status: 'completed',
        startedAt: new Date('2026-05-29T09:21:00.000Z'),
        endedAt: new Date('2026-05-29T09:40:00.000Z'),
        result: 'done',
        artifacts: [],
      },
    ];

    const snapshot = buildUpgradeTelemetrySnapshot({ tickets, attempts, now });

    assert.equal(snapshot.queue.pending, 2);
    assert.equal(snapshot.queue.completed, 1);
    assert.equal(snapshot.churn.terminalCount, 2);
    assert.equal(snapshot.churn.supersededRate, 0.5);
    assert.equal(snapshot.policy.allowlistDenialCount, 1);
    assert.ok(snapshot.alerts.some((entry) => entry.startsWith('superseded-rate-high:')));
    assert.ok(snapshot.alerts.some((entry) => entry.startsWith('allowlist-denial-rate-high:')));
    assert.ok(snapshot.alerts.some((entry) => entry.startsWith('pending-age-p95-high:')));
  });
});
