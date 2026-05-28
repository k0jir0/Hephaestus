import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assertValidTaskTransition, transitionTask } from '../src/task-lifecycle.js';
import type { Task } from '../src/types.js';

function makeTask(status: Task['status']): Task {
  return {
    id: 'task_lifecycle',
    description: 'Check lifecycle transitions',
    status,
    createdAt: new Date(),
  };
}

describe('task lifecycle invariants', () => {
  it('applies valid transitions and timestamps the resulting task', () => {
    const started = transitionTask(makeTask('pending'), 'in_progress');
    const completed = transitionTask(started, 'completed');
    const stale = transitionTask(makeTask('in_progress'), 'stale');
    const superseded = transitionTask(makeTask('blocked'), 'superseded');

    assert.equal(started.status, 'in_progress');
    assert.ok(started.startedAt instanceof Date);
    assert.equal(completed.status, 'completed');
    assert.ok(completed.completedAt instanceof Date);
    assert.equal(stale.status, 'stale');
    assert.ok(stale.blockedAt instanceof Date);
    assert.equal(superseded.status, 'superseded');
    assert.ok(superseded.cancelledAt instanceof Date);
  });

  it('rejects invalid transitions', () => {
    assert.throws(() => assertValidTaskTransition('pending', 'completed', 'unit-test'), /Invalid task transition/);
  });
});
