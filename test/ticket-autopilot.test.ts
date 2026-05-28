import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runTicketAutopilot } from '../src/ticket-autopilot.js';
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

describe('runTicketAutopilot', () => {
  it('requeues retryable tickets and resumes approved held work before self-auditing', async () => {
    const calls = {
      retried: [] as string[],
      resumed: [] as string[],
      seeded: 0,
    };

    const result = await runTicketAutopilot(
      {
        repository: {
          async listTickets() {
            return [
              makeTicket('ticket_blocked', 'blocked'),
              makeTicket('ticket_failed', 'failed'),
              makeTicket('ticket_stale', 'stale'),
              makeTicket('ticket_resume', 'awaiting_approval', makeApproval('approved')),
            ];
          },
          async retryTicket(ticketId: string) {
            calls.retried.push(ticketId);
            return makeTicket(ticketId, 'pending');
          },
          async resumeApprovedTicket(ticketId: string) {
            calls.resumed.push(ticketId);
            return makeTicket(ticketId, 'pending', makeApproval('approved'));
          },
        },
        selfAuditSeeder: {
          async seedTickets() {
            calls.seeded += 1;
            return {
              summary: 'should not seed',
              findings: [],
              created: [],
              skippedDuplicates: [],
              skippedBecauseQueueActive: false,
              rawContent: '',
            };
          },
        },
      },
      {}
    );

    assert.deepEqual(calls.retried, ['ticket_blocked', 'ticket_failed', 'ticket_stale']);
    assert.deepEqual(calls.resumed, ['ticket_resume']);
    assert.equal(calls.seeded, 0);
    assert.equal(result.runnableTicketCount, 0);
    assert.equal(result.awaitingApprovalCount, 0);
    assert.equal(result.requeued.length, 3);
    assert.equal(result.resumed.length, 1);
    assert.equal(result.queueReady, true);
  });

  it('caps futile retries and leaves exhausted tickets for operator review', async () => {
    const calls = {
      retried: [] as string[],
    };

    const result = await runTicketAutopilot(
      {
        repository: {
          async listTickets() {
            return [
              makeTicket('ticket_retry', 'blocked', undefined, 2),
              makeTicket('ticket_exhausted', 'blocked', undefined, 3),
            ];
          },
          async retryTicket(ticketId: string) {
            calls.retried.push(ticketId);
            return makeTicket(ticketId, 'pending');
          },
          async resumeApprovedTicket() {
            throw new Error('resumeApprovedTicket should not be called for blocked tickets');
          },
        },
      },
      { maxAttempts: 3 }
    );

    assert.deepEqual(calls.retried, ['ticket_retry']);
    assert.deepEqual(result.skippedRetryCap.map((ticket) => ticket.id), ['ticket_exhausted']);
    assert.equal(result.queueReady, true);
  });

  it('seeds self-audit when the queue is idle after automation prep', async () => {
    let receivedLimit: number | undefined;
    let receivedDryRun = false;

    const result = await runTicketAutopilot(
      {
        repository: {
          async listTickets() {
            return [makeTicket('ticket_completed', 'completed')];
          },
          async retryTicket() {
            throw new Error('retryTicket should not be called for an idle queue');
          },
          async resumeApprovedTicket() {
            throw new Error('resumeApprovedTicket should not be called for an idle queue');
          },
        },
        selfAuditSeeder: {
          async seedTickets(options) {
            receivedLimit = options?.limit;
            receivedDryRun = options?.dryRun ?? false;
            return {
              summary: 'Self-audit queued one ticket.',
              findings: [],
              created: [{ id: 'ticket_seeded', description: 'Self-audit [high/startup]: Add /health' }],
              skippedDuplicates: [],
              skippedBecauseQueueActive: false,
              rawContent: '',
            };
          },
        },
      },
      {
        dryRun: true,
        selfAuditLimit: 2,
      }
    );

    assert.equal(receivedLimit, 2);
    assert.equal(receivedDryRun, true);
    assert.equal(result.selfAudit?.created.length, 1);
    assert.equal(result.queueReady, true);
  });

  it('does not seed new work while tickets are still waiting on operator approval', async () => {
    let seeded = false;

    const result = await runTicketAutopilot(
      {
        repository: {
          async listTickets() {
            return [makeTicket('ticket_hold', 'awaiting_approval', makeApproval('requested'))];
          },
          async retryTicket() {
            throw new Error('retryTicket should not be called when work is waiting on approval');
          },
          async resumeApprovedTicket() {
            throw new Error('resumeApprovedTicket should not be called for unapproved work');
          },
        },
        selfAuditSeeder: {
          async seedTickets() {
            seeded = true;
            return {
              summary: 'should not seed',
              findings: [],
              created: [],
              skippedDuplicates: [],
              skippedBecauseQueueActive: false,
              rawContent: '',
            };
          },
        },
      },
      {}
    );

    assert.equal(seeded, false);
    assert.equal(result.awaitingApprovalCount, 1);
    assert.equal(result.queueReady, false);
    assert.equal(result.selfAudit, null);
  });
});
