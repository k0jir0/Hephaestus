import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseTaskBoard, renderTaskBoard } from '../src/task-board.js';
import { canTransitionTaskStatus, transitionTask } from '../src/task-lifecycle.js';
import type { Task, TaskStatus, TaskTicket } from '../src/types.js';

const taskStatuses: TaskStatus[] = [
  'pending',
  'in_progress',
  'planned',
  'awaiting_approval',
  'applying',
  'verifying',
  'completed',
  'merged',
  'blocked',
  'failed',
  'cancelled',
];

function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function statusToSection(status: TaskStatus): 'Queue' | 'In Progress' | 'Completed' | 'Blocked' | 'Cancelled' {
  switch (status) {
    case 'pending':
      return 'Queue';
    case 'completed':
    case 'merged':
      return 'Completed';
    case 'blocked':
    case 'failed':
      return 'Blocked';
    case 'cancelled':
      return 'Cancelled';
    default:
      return 'In Progress';
  }
}

describe('Reliability property checks', () => {
  it('preserves lifecycle timestamp invariants across random valid transition sequences', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const rng = createRng(seed);
      let task: Task = {
        id: `task_${seed}`,
        description: `Synthetic task ${seed}`,
        status: 'pending',
        createdAt: new Date('2026-05-27T00:00:00.000Z'),
      };

      for (let step = 0; step < 10; step++) {
        const candidates = taskStatuses.filter((status) => canTransitionTaskStatus(task.status, status));
        if (candidates.length === 0) {
          break;
        }

        const nextStatus = candidates[Math.floor(rng() * candidates.length)]!;
        const at = new Date(task.createdAt.getTime() + (step + 1) * 1_000);
        task = transitionTask(task, nextStatus, at);

        assert.equal(task.status, nextStatus);
        if (task.completedAt) {
          assert.ok(task.completedAt.getTime() <= at.getTime());
        }
        if (task.blockedAt) {
          assert.ok(task.blockedAt.getTime() <= at.getTime());
        }
        if (task.cancelledAt) {
          assert.ok(task.cancelledAt.getTime() <= at.getTime());
        }
      }
    }
  });

  it('reconciles rendered task-board sections with randomized status groupings', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const rng = createRng(seed);
      const tasks: TaskTicket[] = Array.from({ length: 20 }, (_, index) => {
        const status = taskStatuses[Math.floor(rng() * taskStatuses.length)]!;
        return {
          id: `ticket_${seed}_${index}`,
          description: `Task ${seed}-${index}`,
          status,
          createdAt: new Date('2026-05-27T00:00:00.000Z'),
          updatedAt: new Date('2026-05-27T00:00:00.000Z'),
          attemptCount: 0,
          sourceOrder: index + 1,
        };
      });

      const board = renderTaskBoard(tasks);
      const parsed = parseTaskBoard(board);
      const expectedCounts = new Map<string, number>();
      const actualCounts = new Map<string, number>();

      for (const task of tasks) {
        const section = statusToSection(task.status);
        expectedCounts.set(section, (expectedCounts.get(section) ?? 0) + 1);
      }

      for (const item of parsed) {
        actualCounts.set(item.section, (actualCounts.get(item.section) ?? 0) + 1);
      }

      for (const section of ['Queue', 'In Progress', 'Completed', 'Blocked', 'Cancelled']) {
        assert.equal(actualCounts.get(section) ?? 0, expectedCounts.get(section) ?? 0);
      }
    }
  });
});