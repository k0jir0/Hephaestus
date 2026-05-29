import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assertValidTaskTransition,
  transitionTask,
  settleTaskStatus,
} from '../src/domain/tickets/ticket-lifecycle.js';
import { validateCompletionMutationEvidence } from '../src/domain/tickets/completion-invariants.js';
import { decideTaskCompletion } from '../src/domain/tickets/completion-policy.js';
import {
  decideTaskFailure,
  resolveMemoryFailureStatus,
  resolveRuntimeFailureStatus,
  resolveTaskFailureStatus,
  resolveTransientFailureAttemptCap,
  shouldReturnToIdleAfterFailure,
  shouldCountAgainstGlobalErrorBudget,
  shouldEscalateToBlocked,
} from '../src/domain/tickets/failure-policy.js';
import {
  assertAmendedRetryDescription,
  assertRetryableTicketStatus,
  isRetryableTicketStatus,
} from '../src/domain/tickets/retry-policy.js';
import {
  assertValidTaskAttemptTransition,
  transitionTaskAttempt,
  settleTaskAttemptStatus,
  resolveTaskAttemptStatusTransition,
} from '../src/domain/attempts/attempt-lifecycle.js';
import type { Task, TaskAttempt, TaskPlan } from '../src/types.js';

function makeTask(status: Task['status']): Task {
  return {
    id: 'task_lifecycle',
    description: 'Check lifecycle transitions',
    status,
    createdAt: new Date(),
  };
}

function makeAttempt(status: TaskAttempt['status']): TaskAttempt {
  return {
    id: 'attempt_lifecycle',
    ticketId: 'task_lifecycle',
    attemptNumber: 1,
    status,
    startedAt: new Date(),
    artifacts: [],
  };
}

function makePlan(changeType: 'inspect' | 'update', path = 'src/runtime.ts'): TaskPlan {
  return {
    summary: 'Check completion invariants',
    intendedFiles: [
      {
        path,
        purpose: 'Exercise completion invariant',
        changeType,
      },
    ],
    commands: [],
    verification: ['Review invariant result'],
    risks: [],
  };
}

describe('task lifecycle invariants', () => {
  it('applies valid transitions and timestamps the resulting task', () => {
    const started = transitionTask(makeTask('pending'), 'in_progress');
    const completed = transitionTask(started, 'completed');
    const stale = transitionTask(makeTask('in_progress'), 'stale');
    const superseded = transitionTask(makeTask('blocked'), 'superseded');
    const settled = settleTaskStatus(makeTask('completed'), 'blocked');

    assert.equal(started.status, 'in_progress');
    assert.ok(started.startedAt instanceof Date);
    assert.equal(completed.status, 'completed');
    assert.ok(completed.completedAt instanceof Date);
    assert.equal(stale.status, 'stale');
    assert.ok(stale.blockedAt instanceof Date);
    assert.equal(superseded.status, 'superseded');
    assert.ok(superseded.cancelledAt instanceof Date);
    assert.equal(settled.status, 'blocked');
    assert.ok(settled.blockedAt instanceof Date);
  });

  it('rejects invalid transitions', () => {
    assert.throws(() => assertValidTaskTransition('pending', 'completed', 'unit-test'), /Invalid task transition/);
  });

  it('applies attempt transitions and rejects terminal rewrites', () => {
    const completed = transitionTaskAttempt(makeAttempt('in_progress'), 'completed');
    const settled = settleTaskAttemptStatus(makeAttempt('completed'), 'blocked');
    const resolved = resolveTaskAttemptStatusTransition('in_progress', 'awaiting_approval', 'unit-test');

    assert.equal(completed.status, 'completed');
    assert.ok(completed.endedAt instanceof Date);
    assert.equal(settled.status, 'blocked');
    assert.equal(resolved, 'awaiting_approval');
    assert.throws(
      () => assertValidTaskAttemptTransition('completed', 'failed', 'unit-test'),
      /Invalid task attempt transition/
    );
  });

  it('requires governed mutation evidence for mutable completion plans', () => {
    assert.equal(validateCompletionMutationEvidence(makePlan('inspect'), []), null);
    assert.match(
      validateCompletionMutationEvidence(makePlan('update'), []) ?? '',
      /No governed mutation evidence/
    );
    assert.match(
      validateCompletionMutationEvidence(makePlan('update', 'src/runtime.ts'), ['README.md']) ?? '',
      /do not intersect mutable intended files/
    );
    assert.equal(
      validateCompletionMutationEvidence(makePlan('update', 'SRC\\RUNTIME.ts'), ['src/runtime.ts']),
      null
    );
  });

  it('decides completion outcomes from tool and evidence results', () => {
    assert.deepEqual(
      decideTaskCompletion({
        plan: makePlan('inspect'),
        observedMutatedPaths: [],
      }),
      { action: 'complete' }
    );
    assert.deepEqual(
      decideTaskCompletion({
        plan: makePlan('inspect'),
        observedMutatedPaths: [],
        failureReason: 'command failed',
      }),
      {
        action: 'block',
        reason: 'command failed',
        forceBlocked: false,
      }
    );
    assert.deepEqual(
      decideTaskCompletion({
        plan: makePlan('update'),
        observedMutatedPaths: [],
      }),
      {
        action: 'block',
        reason: 'No governed mutation evidence was recorded for mutable intended files (src/runtime.ts). Completion requires at least one applied mutation in declared targets.',
        forceBlocked: true,
      }
    );
    assert.deepEqual(
      decideTaskCompletion({
        plan: makePlan('update'),
        observedMutatedPaths: ['src/runtime.ts'],
        awaitingApprovalReason: 'approval required',
      }),
      {
        action: 'awaiting_approval',
        reason: 'approval required',
        pendingToolCalls: undefined,
        approvalState: undefined,
      }
    );
  });

  it('decides failure budget and blocked escalation policy', () => {
    assert.equal(shouldCountAgainstGlobalErrorBudget('command failed'), true);
    assert.equal(
      shouldCountAgainstGlobalErrorBudget('No governed mutation evidence was recorded for mutable intended files.'),
      false
    );
    assert.equal(
      shouldEscalateToBlocked({
        reason: 'backend unavailable timeout',
        attemptCount: 0,
        maxTransientFailures: 2,
      }),
      false
    );
    assert.equal(
      shouldEscalateToBlocked({
        reason: 'backend unavailable timeout',
        attemptCount: 2,
        maxTransientFailures: 2,
      }),
      true
    );
    assert.equal(
      shouldEscalateToBlocked({
        reason: 'command is not allowlisted',
        attemptCount: 0,
        maxTransientFailures: 2,
      }),
      true
    );
    assert.equal(
      shouldEscalateToBlocked({
        reason: 'timeout',
        attemptCount: 0,
        forceBlocked: true,
        maxTransientFailures: 2,
      }),
      true
    );
    assert.deepEqual(
      decideTaskFailure({
        reason: 'Observed mutations do not intersect mutable intended files.',
        attemptCount: 0,
        forceBlocked: true,
        maxTransientFailures: 2,
      }),
      {
        countAgainstGlobalErrorBudget: false,
        hardBlocked: true,
      }
    );
    assert.equal(resolveTaskFailureStatus(true), 'blocked');
    assert.equal(resolveTaskFailureStatus(false), 'failed');
    assert.equal(resolveRuntimeFailureStatus(true), 'blocked');
    assert.equal(resolveRuntimeFailureStatus(false), 'error');
    assert.equal(resolveMemoryFailureStatus(true), 'Blocked');
    assert.equal(resolveMemoryFailureStatus(false), 'Failed');
    assert.equal(shouldReturnToIdleAfterFailure(true), false);
    assert.equal(shouldReturnToIdleAfterFailure(false), true);
  });

  it('normalizes transient failure caps', () => {
    assert.equal(resolveTransientFailureAttemptCap(Number.NaN), 2);
    assert.equal(resolveTransientFailureAttemptCap(0), 1);
    assert.equal(resolveTransientFailureAttemptCap(4), 4);
  });

  it('evaluates retry policy for ticket status and amended descriptions', () => {
    assert.equal(isRetryableTicketStatus('blocked'), true);
    assert.equal(isRetryableTicketStatus('failed'), true);
    assert.equal(isRetryableTicketStatus('stale'), true);
    assert.equal(isRetryableTicketStatus('cancelled'), true);
    assert.equal(isRetryableTicketStatus('pending'), false);

    assert.doesNotThrow(() => assertRetryableTicketStatus('failed', 'unit-test'));
    assert.throws(
      () => assertRetryableTicketStatus('completed', 'unit-test'),
      /Only blocked, failed, stale, or cancelled tickets can be retried/
    );

    assert.doesNotThrow(() => assertAmendedRetryDescription(undefined, 'amended description'));
    assert.doesNotThrow(() => assertAmendedRetryDescription('Retry with narrow scope', 'amended description'));
    assert.throws(
      () => assertAmendedRetryDescription('   ', 'Amended retry description'),
      /Amended retry description must be a non-empty string/
    );
  });
});
