import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildApprovedResumeToolCalls,
  resolveApprovedResumeEligibility,
} from '../src/domain/tickets/approval-resume-policy.js';
import type { TaskPlan, ToolCall } from '../src/types.js';

function makePlan(): TaskPlan {
  return {
    summary: 'Resume approved patch',
    intendedFiles: [
      {
        path: 'README.md',
        changeType: 'update',
        purpose: 'Exercise approval resume',
      },
    ],
    commands: [],
    verification: ['Review patch result'],
    risks: [],
  };
}

function makePatchCall(patch: string): ToolCall {
  return {
    name: 'patch.apply',
    arguments: { patch },
  };
}

describe('approval resume policy', () => {
  it('reports missing resume prerequisites through shared eligibility checks', () => {
    assert.equal(resolveApprovedResumeEligibility({}).reason, 'missing_plan');
    assert.equal(
      resolveApprovedResumeEligibility({ plan: makePlan() }).reason,
      'missing_tool_calls'
    );
    assert.equal(
      resolveApprovedResumeEligibility({
        plan: makePlan(),
        toolCalls: [makePatchCall('diff')],
        approval: {
          requestId: 'approval_req',
          status: 'requested',
          requestedAt: new Date(),
        },
      }).reason,
      'missing_approval'
    );
    assert.equal(
      resolveApprovedResumeEligibility({
        plan: makePlan(),
        toolCalls: [makePatchCall('diff')],
        approval: {
          requestId: 'approval_req',
          status: 'approved',
          requestedAt: new Date(),
        },
      }).reason,
      'missing_approval_token'
    );
    assert.equal(
      resolveApprovedResumeEligibility({
        plan: makePlan(),
        toolCalls: [{ name: 'repo.search', arguments: { query: 'runtime' } }],
        approval: {
          requestId: 'approval_req',
          status: 'approved',
          requestedAt: new Date(),
          approvalId: 'approval_token',
        },
      }).reason,
      'missing_patch_apply'
    );
  });

  it('injects the approval token into the first patch apply call only', () => {
    const firstPatch = makePatchCall('diff --git a/README.md b/README.md');
    const secondPatch = makePatchCall('diff --git a/src/runtime.ts b/src/runtime.ts');

    const resumed = buildApprovedResumeToolCalls({
      plan: makePlan(),
      toolCalls: [
        { name: 'repo.search', arguments: { query: 'runtime' } },
        firstPatch,
        secondPatch,
      ],
      approval: {
        requestId: 'approval_req',
        status: 'approved',
        requestedAt: new Date(),
        approvalId: 'approval_token',
      },
    });

    assert.equal(resumed?.[0]?.arguments.approvalId, undefined);
    assert.equal(resumed?.[1]?.arguments.approvalId, 'approval_token');
    assert.equal(resumed?.[2]?.arguments.approvalId, undefined);
    assert.equal(firstPatch.arguments.approvalId, undefined);
  });

  it('does not resume without persisted plan, approved token, or patch calls', () => {
    assert.equal(
      buildApprovedResumeToolCalls({
        toolCalls: [makePatchCall('diff')],
        approval: {
          requestId: 'approval_req',
          status: 'approved',
          requestedAt: new Date(),
          approvalId: 'approval_token',
        },
      }),
      null
    );
    assert.equal(
      buildApprovedResumeToolCalls({
        plan: makePlan(),
        toolCalls: [makePatchCall('diff')],
        approval: {
          requestId: 'approval_req',
          status: 'requested',
          requestedAt: new Date(),
        },
      }),
      null
    );
    assert.equal(
      buildApprovedResumeToolCalls({
        plan: makePlan(),
        toolCalls: [{ name: 'repo.search', arguments: { query: 'runtime' } }],
        approval: {
          requestId: 'approval_req',
          status: 'approved',
          requestedAt: new Date(),
          approvalId: 'approval_token',
        },
      }),
      null
    );
  });
});
