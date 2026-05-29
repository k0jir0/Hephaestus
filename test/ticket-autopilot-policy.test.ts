import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  evaluateTicketAutopilotGateFailures,
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
  attemptCount = 0
): TaskTicket {
  return {
    id,
    description: id,
    status,
    createdAt: new Date(),
    updatedAt: new Date(),
    attemptCount,
    sourceOrder: 1,
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
    assert.deepEqual(schedule.skippedRetryCap.map((ticket) => ticket.id), ['failed_exhausted']);
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
