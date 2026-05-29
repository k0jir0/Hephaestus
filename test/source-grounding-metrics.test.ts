import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { computeSourceGroundingMetrics, formatSourceGroundingMetrics } from '../src/source-grounding-metrics.js';
import type { TaskTicket } from '../src/types.js';

function makeTicket(id: string, description: string): TaskTicket {
  const now = new Date('2026-05-29T00:00:00.000Z');
  return {
    id,
    description,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    attemptCount: 0,
    sourceOrder: 1,
  };
}

describe('source grounding metrics', () => {
  it('computes coverage across blueprint and non-blueprint tickets', () => {
    const tickets: TaskTicket[] = [
      makeTicket('ticket_1', 'Fix src/runtime.ts parser and verify with npm run build; expected signal: build exits 0.'),
      makeTicket('ticket_2', 'Implement D2 replay checks in src/task-store.ts and verify with npm run test; expected signal: tests exit 0.'),
      makeTicket('ticket_3', 'Implement D3 policy guard in src/runtime.ts using Yao2023ReAct and verify with npm run test; expected signal: tests exit 0.'),
      makeTicket('ticket_4', 'Implement blueprint D2 projection checks in src/task-store.ts grounded by sources/notes/ChandyLamport1985.md and verify with npm run test; expected signal: tests exit 0.'),
    ];

    const metrics = computeSourceGroundingMetrics(tickets);

    assert.equal(metrics.totalTickets, 4);
    assert.equal(metrics.requiredTickets, 3);
    assert.equal(metrics.groundedTickets, 2);
    assert.equal(metrics.groundingCoverage, 2 / 3);
    assert.deepEqual(metrics.missingGroundingTickets, ['ticket_2']);
    assert.deepEqual(metrics.groundingKeyCounts, [
      { key: 'ChandyLamport1985', count: 1 },
      { key: 'Yao2023ReAct', count: 1 },
    ]);
  });

  it('treats no-required tickets as full coverage', () => {
    const tickets: TaskTicket[] = [
      makeTicket('ticket_1', 'Fix src/ui.ts styling overflow and verify with npm run build; expected signal: build exits 0.'),
    ];

    const metrics = computeSourceGroundingMetrics(tickets);

    assert.equal(metrics.requiredTickets, 0);
    assert.equal(metrics.groundedTickets, 0);
    assert.equal(metrics.groundingCoverage, 1);
    assert.deepEqual(metrics.missingGroundingTickets, []);
    assert.deepEqual(metrics.groundingKeyCounts, []);
  });

  it('formats readable summary output', () => {
    const formatted = formatSourceGroundingMetrics({
      totalTickets: 4,
      requiredTickets: 2,
      groundedTickets: 1,
      missingGroundingTickets: ['ticket_a', 'ticket_b'],
      groundingCoverage: 0.5,
      groundingKeyCounts: [
        { key: 'ChandyLamport1985', count: 1 },
        { key: 'Yao2023ReAct', count: 2 },
      ],
    });

    assert.match(formatted, /Source Grounding Coverage/);
    assert.match(formatted, /Coverage: 50.0%/);
    assert.match(formatted, /ticket_a, ticket_b/);
    assert.match(formatted, /Grounding key usage: Yao2023ReAct=2, ChandyLamport1985=1/);
  });
});
