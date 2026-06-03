import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  evaluateTicketAutopilotGateFailures,
  getTicketAutopilotRetryQuarantineReason,
  planTicketAutopilotSchedule,
  resolveSelfAuditSeedLimit,
  shouldSeedSelfAuditFromAutopilot,
} from '../src/domain/scheduling/ticket-autopilot-policy.js';
import type { TaskApprovalState, TaskTicket } from '../src/types.js';

function makeApproval(status: TaskApprovalState['status']): TaskApprovalState {
  return {
    requestId: `request_${status}`,
    status,
    requestedAt: new Date(),
    approvalId: status === 'approved' ? 'approval_demo' : undefined,
  };
}

function makeTicket(
  id: string,
  status: TaskTicket['status'],
  approval?: TaskApprovalState,
  attemptCount = 0,
  sourceOrder = 1
): TaskTicket {
  return {
    id,
    description: id,
    status,
    createdAt: new Date(),
    updatedAt: new Date(),
    attemptCount,
    sourceOrder,
    approval,
  };
}

describe('ticket autopilot policy', () => {
  it('plans wave capacity, approved resumes, and retry cap partitions', () => {
    const schedule = planTicketAutopilotSchedule(
      [
        makeTicket('pending_1', 'pending'),
        makeTicket('resume_1', 'awaiting_approval', makeApproval('approved')),
        makeTicket('approval_1', 'awaiting_approval', makeApproval('requested')),
        makeTicket('blocked_1', 'blocked'),
        makeTicket('failed_exhausted', 'failed', undefined, 3),
        makeTicket('cancelled_retry', 'cancelled'),
      ],
      {
        includeCancelled: true,
        maxAttempts: 3,
        waveSize: 3,
        maxActiveTickets: 10,
      }
    );

    assert.equal(schedule.runnableTicketCount, 1);
    assert.equal(schedule.awaitingApprovalCount, 1);
    assert.equal(schedule.activeTicketCount, 5);
    assert.equal(schedule.availableWaveSlots, 3);
    assert.deepEqual(schedule.resumableTickets.map((ticket) => ticket.id), ['resume_1']);
    assert.deepEqual(schedule.retryableTickets.map((ticket) => ticket.id), ['blocked_1', 'cancelled_retry']);
    assert.deepEqual(schedule.quarantinedRetryTickets.map((ticket) => ticket.id), []);
    assert.deepEqual(schedule.skippedRetryCap.map((ticket) => ticket.id), ['failed_exhausted']);
  });

  it('quarantines chronic retry cohorts and prioritizes recovery-first tickets', () => {
    const allowlistDenied = {
      ...makeTicket('blocked_allowlist', 'blocked', undefined, 0, 1),
      error: 'Command is not allowlisted: npm run strange-test',
    };
    const fileBoundaryDenied = {
      ...makeTicket('blocked_boundary', 'failed', undefined, 0, 2),
      error: 'patch touches src/agent.ts not declared in the validated plan',
    };
    const genericRetry = {
      ...makeTicket('generic_retry', 'blocked', undefined, 0, 3),
      description: 'Inspect exploratory docs cleanup',
    };
    const recoveryFirstRetry = {
      ...makeTicket('fix_retry', 'blocked', undefined, 0, 4),
      description: 'FIX telemetry writer guard',
    };

    const schedule = planTicketAutopilotSchedule(
      [allowlistDenied, fileBoundaryDenied, genericRetry, recoveryFirstRetry],
      {
        maxAttempts: 3,
        waveSize: 4,
        maxActiveTickets: 4,
      }
    );

    assert.equal(getTicketAutopilotRetryQuarantineReason(allowlistDenied), 'allowlist-denial');
    assert.equal(getTicketAutopilotRetryQuarantineReason(fileBoundaryDenied), 'plan-or-file-boundary');
    assert.deepEqual(schedule.quarantinedRetryTickets.map((ticket) => ticket.id), [
      'blocked_allowlist',
      'blocked_boundary',
    ]);
    assert.deepEqual(schedule.retryableTickets.map((ticket) => ticket.id), ['fix_retry', 'generic_retry']);
  });

  it('reports efficiency gate failures as stable policy reasons', () => {
    const tickets = [
      makeTicket('done_1', 'completed'),
      makeTicket('done_2', 'completed'),
      makeTicket('sup_1', 'superseded'),
      makeTicket('sup_2', 'superseded'),
      makeTicket('sup_3', 'superseded'),
      makeTicket('sup_4', 'superseded'),
      makeTicket('sup_5', 'superseded'),
      makeTicket('can_1', 'cancelled'),
      makeTicket('can_2', 'cancelled'),
      makeTicket('can_3', 'cancelled'),
      makeTicket('blk_1', 'blocked'),
      makeTicket('blk_2', 'blocked'),
      makeTicket('blk_3', 'blocked'),
      makeTicket('blk_4', 'blocked'),
      makeTicket('blk_5', 'blocked'),
      makeTicket('blk_6', 'blocked'),
      { ...makeTicket('err_1', 'failed'), error: 'Command is not allowlisted.' },
      { ...makeTicket('err_2', 'failed'), error: 'Command is not allowlisted.' },
      { ...makeTicket('err_3', 'failed'), error: 'Command is not allowlisted.' },
      { ...makeTicket('err_4', 'failed'), error: 'Command is not allowlisted.' },
      { ...makeTicket('err_5', 'failed'), error: 'Command is not allowlisted.' },
    ];

    const failures = evaluateTicketAutopilotGateFailures(tickets);

    assert.ok(failures.some((failure) => failure.startsWith('completion-rate-low:')));
    assert.ok(failures.some((failure) => failure.startsWith('superseded-rate-high:')));
    assert.ok(failures.some((failure) => failure.startsWith('blocked-count-high:')));
    assert.ok(failures.some((failure) => failure.startsWith('allowlist-denial-rate-high:')));
  });

  it('counts only recent blocked tickets when a blocked window is configured', () => {
    const nowMs = Date.parse('2026-06-03T12:00:00.000Z');
    const staleBlocked = {
      ...makeTicket('blk_old', 'blocked'),
      blockedAt: new Date('2026-05-20T12:00:00.000Z'),
      updatedAt: new Date('2026-05-20T12:00:00.000Z'),
    };
    const recentBlocked = {
      ...makeTicket('blk_recent', 'blocked'),
      blockedAt: new Date('2026-06-02T12:00:00.000Z'),
      updatedAt: new Date('2026-06-02T12:00:00.000Z'),
    };

    const failures = evaluateTicketAutopilotGateFailures([staleBlocked, recentBlocked], {
      maxBlockedTickets: 0,
      blockedWindowDays: 7,
      nowMs,
    });

    assert.ok(failures.includes('blocked-count-high:1>0'));
  });

  it('reports source-grounding and source-evidence gate failures when thresholds are violated', () => {
    const failures = evaluateTicketAutopilotGateFailures(
      [
        makeTicket('ticket_1', 'completed'),
      ],
      {
        minSourceGroundingCoverage: 0.9,
        minSourceEvidenceCoverage: 0.95,
        maxSourceDriftedTickets: 0,
        sourceGroundingSnapshot: {
          groundingCoverage: 0.5,
          eventEvidence: {
            auditableTickets: 4,
            eventEvidenceCoverage: 0.5,
            driftedTickets: ['ticket_a'],
          },
        },
      }
    );

    assert.ok(failures.some((failure) => failure.startsWith('source-grounding-coverage-low:')));
    assert.ok(failures.some((failure) => failure.startsWith('source-evidence-coverage-low:')));
    assert.ok(failures.some((failure) => failure.startsWith('source-evidence-drifted-high:')));
  });

  it('fails closed when source-grounding snapshot is unavailable', () => {
    const failures = evaluateTicketAutopilotGateFailures([
      makeTicket('ticket_1', 'completed'),
    ], {
      enforceSourceSnapshot: true,
    });

    assert.ok(failures.includes('source-grounding-snapshot-missing'));
  });

  it('fails closed when source snapshot timestamp is invalid under enforcement mode', () => {
    const failures = evaluateTicketAutopilotGateFailures(
      [makeTicket('ticket_1', 'completed')],
      {
        enforceSourceSnapshot: true,
        sourceGroundingSnapshot: {
          timestamp: 'not-a-timestamp',
          groundingCoverage: 1,
          eventEvidence: {
            auditableTickets: 0,
            eventEvidenceCoverage: 1,
            driftedTickets: [],
          },
        },
      }
    );

    assert.ok(failures.includes('source-grounding-snapshot-invalid'));
  });

  it('fails closed when source snapshot is stale under enforcement mode', () => {
    const failures = evaluateTicketAutopilotGateFailures(
      [makeTicket('ticket_1', 'completed')],
      {
        enforceSourceSnapshot: true,
        maxSourceSnapshotAgeHours: 24,
        nowMs: Date.parse('2026-05-29T12:00:00.000Z'),
        sourceGroundingSnapshot: {
          timestamp: '2026-05-27T00:00:00.000Z',
          groundingCoverage: 1,
          eventEvidence: {
            auditableTickets: 0,
            eventEvidenceCoverage: 1,
            driftedTickets: [],
          },
        },
      }
    );

    assert.ok(failures.some((failure) => failure.startsWith('source-grounding-snapshot-stale:')));
  });

  it('does not fail source-evidence coverage when no auditable source tickets exist', () => {
    const failures = evaluateTicketAutopilotGateFailures(
      [
        makeTicket('ticket_1', 'completed'),
      ],
      {
        minSourceEvidenceCoverage: 0.95,
        sourceGroundingSnapshot: {
          groundingCoverage: 1,
          eventEvidence: {
            auditableTickets: 0,
            eventEvidenceCoverage: 0,
            driftedTickets: [],
          },
        },
      }
    );

    assert.equal(
      failures.some((failure) => failure.startsWith('source-evidence-coverage-low:')),
      false
    );
  });

  it('includes externally supplied gate failures for strict runtime enforcement', () => {
    const failures = evaluateTicketAutopilotGateFailures(
      [makeTicket('ticket_1', 'completed')],
      {
        additionalGateFailures: ['d2-domain-deficit-high:1>0'],
      }
    );

    assert.ok(failures.includes('d2-domain-deficit-high:1>0'));
  });

  it('decides when idle autopilot should seed self-audit work', () => {
    assert.equal(
      shouldSeedSelfAuditFromAutopilot({
        blockedByGates: false,
        availableWaveSlots: 2,
        queueReady: false,
        awaitingApprovalCount: 0,
        seedSelfAuditWhenIdle: true,
        hasSelfAuditSeeder: true,
      }),
      true
    );
    assert.equal(
      shouldSeedSelfAuditFromAutopilot({
        blockedByGates: false,
        availableWaveSlots: 2,
        queueReady: true,
        awaitingApprovalCount: 0,
        seedSelfAuditWhenIdle: true,
        hasSelfAuditSeeder: true,
      }),
      false
    );
    assert.equal(resolveSelfAuditSeedLimit(5, 2), 2);
  });
});
