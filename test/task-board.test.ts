import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renderTaskBoard } from '../src/task-board.js';
import type { TaskTicket } from '../src/types.js';

describe('task board rendering', () => {
  it('renders the clarified section labels and queue guidance', () => {
    const board = renderTaskBoard([
      {
        id: 'ticket_demo_1',
        description: 'Ship demo queue item',
        status: 'pending',
        createdAt: new Date('2026-05-27T00:00:00.000Z'),
        updatedAt: new Date('2026-05-27T00:00:00.000Z'),
        attemptCount: 0,
        sourceOrder: 1,
      },
      {
        id: 'ticket_demo_2',
        description: 'Investigate blocked issue',
        status: 'blocked',
        createdAt: new Date('2026-05-27T00:00:00.000Z'),
        updatedAt: new Date('2026-05-27T00:00:00.000Z'),
        attemptCount: 0,
        sourceOrder: 2,
      },
    ] satisfies TaskTicket[]);

    assert.match(board, /Pending tickets run top-to-bottom\. Add new work at the end of this section\./);
    assert.match(board, /Tickets currently being executed, applied, or verified\./);
    assert.match(board, /Tickets that finished successfully appear here\./);
    assert.match(board, /Tickets waiting on operator action or follow-up fixes before retry\./);
    assert.match(board, /Tickets intentionally stopped, superseded, or no longer needed\./);
    assert.match(board, /Hephaestus processes pending work from the Queue section top-to-bottom\./);
    assert.match(board, /Keep new work as `- \[ \]` items in Queue\. Hephaestus moves tickets between sections automatically\./);
  });
});