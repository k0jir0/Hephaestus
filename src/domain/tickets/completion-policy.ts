import type { TaskApprovalState, TaskPlan, ToolCall } from '../../types.js';
import { validateCompletionMutationEvidence } from './completion-invariants.js';

export type TaskCompletionPolicyDecision =
  | {
      action: 'awaiting_approval';
      reason: string;
      pendingToolCalls?: ToolCall[];
      approvalState?: TaskApprovalState;
    }
  | {
      action: 'block';
      reason: string;
      forceBlocked: boolean;
    }
  | {
      action: 'complete';
    };

export interface TaskCompletionPolicyInput {
  plan: TaskPlan | undefined;
  observedMutatedPaths: string[];
  failureReason?: string;
  awaitingApprovalReason?: string;
  pendingToolCalls?: ToolCall[];
  approvalState?: TaskApprovalState;
}

export function decideTaskCompletion(
  input: TaskCompletionPolicyInput
): TaskCompletionPolicyDecision {
  if (input.awaitingApprovalReason) {
    return {
      action: 'awaiting_approval',
      reason: input.awaitingApprovalReason,
      pendingToolCalls: input.pendingToolCalls,
      approvalState: input.approvalState,
    };
  }

  if (input.failureReason) {
    return {
      action: 'block',
      reason: input.failureReason,
      forceBlocked: false,
    };
  }

  const mutationEvidenceFailure = validateCompletionMutationEvidence(
    input.plan,
    input.observedMutatedPaths
  );
  if (mutationEvidenceFailure) {
    return {
      action: 'block',
      reason: mutationEvidenceFailure,
      forceBlocked: true,
    };
  }

  return { action: 'complete' };
}
