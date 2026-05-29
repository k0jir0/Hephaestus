import type { Task, ToolCall } from '../../types.js';

export interface ApprovalResumeCandidate {
  plan?: Task['plan'];
  toolCalls?: ToolCall[];
  approval?: Task['approval'];
}

export type ApprovalResumeEligibilityReason =
  | 'missing_plan'
  | 'missing_tool_calls'
  | 'missing_approval'
  | 'missing_approval_token'
  | 'missing_patch_apply';

export interface ApprovalResumeEligibility {
  resumable: boolean;
  reason?: ApprovalResumeEligibilityReason;
}

export function resolveApprovedResumeEligibility(
  candidate: ApprovalResumeCandidate
): ApprovalResumeEligibility {
  if (!candidate.plan) {
    return { resumable: false, reason: 'missing_plan' };
  }

  if (!candidate.toolCalls || candidate.toolCalls.length === 0) {
    return { resumable: false, reason: 'missing_tool_calls' };
  }

  if (candidate.approval?.status !== 'approved') {
    return { resumable: false, reason: 'missing_approval' };
  }

  if (!candidate.approval.approvalId) {
    return { resumable: false, reason: 'missing_approval_token' };
  }

  if (!candidate.toolCalls.some((toolCall) => toolCall.name === 'patch.apply')) {
    return { resumable: false, reason: 'missing_patch_apply' };
  }

  return { resumable: true };
}

export function buildApprovedResumeToolCalls(candidate: ApprovalResumeCandidate): ToolCall[] | null {
  const eligibility = resolveApprovedResumeEligibility(candidate);
  if (!eligibility.resumable) {
    return null;
  }

  if (!candidate.toolCalls) {
    return null;
  }

  const approvalId = candidate.approval?.approvalId;
  let appliedApproval = false;
  const resumedToolCalls = candidate.toolCalls.map((toolCall) => {
    if (!appliedApproval && toolCall.name === 'patch.apply') {
      appliedApproval = true;
      return {
        ...toolCall,
        arguments: {
          ...toolCall.arguments,
          approvalId,
        },
      };
    }

    return toolCall;
  });

  return appliedApproval ? resumedToolCalls : null;
}
