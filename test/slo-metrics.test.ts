import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { computeOperationalSLOMetrics, formatOperationalSLOMetrics } from '../src/slo-metrics.js';
import type { TaskAttempt, TaskEvent, TaskTicket } from '../src/types.js';

describe('Operational SLO metrics', () => {
  it('computes repository-facing SLOs from tickets, attempts, and events', () => {
    const tickets: TaskTicket[] = [
      {
        id: 'ticket_1',
        description: 'Completed after one attempt',
        status: 'completed',
        createdAt: new Date('2026-05-27T00:00:00.000Z'),
        updatedAt: new Date('2026-05-27T00:00:05.000Z'),
        attemptCount: 1,
        sourceOrder: 1,
      },
      {
        id: 'ticket_2',
        description: 'Blocked, retried, then completed',
        status: 'completed',
        createdAt: new Date('2026-05-27T00:01:00.000Z'),
        updatedAt: new Date('2026-05-27T00:01:12.000Z'),
        attemptCount: 2,
        sourceOrder: 2,
      },
      {
        id: 'ticket_3',
        description: 'Needs approval',
        status: 'awaiting_approval',
        createdAt: new Date('2026-05-27T00:02:00.000Z'),
        updatedAt: new Date('2026-05-27T00:02:04.000Z'),
        attemptCount: 1,
        sourceOrder: 3,
        error: 'Patch requires approval before apply: patch touches 2 files',
      },
    ];
    const attemptsByTicket = new Map<string, TaskAttempt[]>([
      ['ticket_1', [
        {
          id: 'attempt_1',
          ticketId: 'ticket_1',
          attemptNumber: 1,
          status: 'completed',
          startedAt: new Date('2026-05-27T00:00:02.000Z'),
          endedAt: new Date('2026-05-27T00:00:05.000Z'),
          result: 'done',
          artifacts: [],
        },
      ]],
      ['ticket_2', [
        {
          id: 'attempt_2a',
          ticketId: 'ticket_2',
          attemptNumber: 1,
          status: 'blocked',
          startedAt: new Date('2026-05-27T00:01:01.000Z'),
          endedAt: new Date('2026-05-27T00:01:05.000Z'),
          error: 'Backend timeout: transient failure',
          artifacts: [],
        },
        {
          id: 'attempt_2b',
          ticketId: 'ticket_2',
          attemptNumber: 2,
          status: 'completed',
          startedAt: new Date('2026-05-27T00:01:09.000Z'),
          endedAt: new Date('2026-05-27T00:01:12.000Z'),
          result: 'done',
          artifacts: [],
        },
      ]],
      ['ticket_3', [
        {
          id: 'attempt_3',
          ticketId: 'ticket_3',
          attemptNumber: 1,
          status: 'awaiting_approval',
          startedAt: new Date('2026-05-27T00:02:01.000Z'),
          endedAt: new Date('2026-05-27T00:02:04.000Z'),
          error: 'Patch requires approval before apply: patch touches 2 files',
          artifacts: [],
        },
      ]],
    ]);
    const events: TaskEvent[] = [
      { ticketId: 'ticket_1', type: 'created', createdAt: new Date('2026-05-27T00:00:00.000Z') },
      { ticketId: 'ticket_1', type: 'attempt-started', createdAt: new Date('2026-05-27T00:00:02.000Z') },
      { ticketId: 'ticket_2', type: 'created', createdAt: new Date('2026-05-27T00:01:00.000Z') },
      { ticketId: 'ticket_2', type: 'attempt-started', createdAt: new Date('2026-05-27T00:01:01.000Z') },
      { ticketId: 'ticket_3', type: 'created', createdAt: new Date('2026-05-27T00:02:00.000Z') },
      { ticketId: 'ticket_3', type: 'attempt-started', createdAt: new Date('2026-05-27T00:02:01.000Z') },
      { ticketId: 'ticket_3', type: 'board-synced', createdAt: new Date('2026-05-27T00:02:04.000Z') },
    ];

    const metrics = computeOperationalSLOMetrics({ tickets, attemptsByTicket, events });
    const summary = formatOperationalSLOMetrics(metrics);

    assert.equal(metrics.totalTickets, 3);
    assert.equal(metrics.totalAttempts, 4);
    assert.equal(metrics.completedTickets, 2);
    assert.equal(metrics.awaitingApprovalTickets, 1);
    assert.equal(metrics.blockedRetrySuccessRatio, 1);
    assert.equal(metrics.executionFailureTaxonomyStability, 0.5);
    assert.match(summary, /Average admission-to-start latency/);
    assert.match(summary, /backend timeout=1/);
  });
});