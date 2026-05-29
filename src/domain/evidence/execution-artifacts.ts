import type {
  EngineeringToolName,
  EngineeringToolResult,
  PlannedFileChangeType,
  TaskApprovalState,
  ToolPolicySnapshot,
} from '../../types.js';

export interface BackendEvidenceInput {
  correlationId: string;
  backend: string;
  model?: string;
}

export interface ToolExecutionArtifactInput {
  correlationId: string;
  tool: EngineeringToolName;
  subject: string;
  result: EngineeringToolResult;
}

export interface PatchDeltaArtifactInput {
  correlationId: string;
  subject: string;
  dryRunResult: EngineeringToolResult;
  applyResult: EngineeringToolResult;
}

export function formatToolExecutionArtifact(input: ToolExecutionArtifactInput): string {
  const reasonCodeSuffix = input.result.reasonCode ? ` [${input.result.reasonCode}]` : '';
  return `[${input.correlationId}] ${input.tool} ${input.subject} -> ${input.result.status}${reasonCodeSuffix}: ${input.result.summary}`;
}

export function formatBackendEvidenceArtifact(input: BackendEvidenceInput): string {
  return `[${input.correlationId}] backend.${input.backend} model=${input.model || 'default'}`;
}

export function formatPolicySnapshotArtifact(
  correlationId: string,
  snapshot: ToolPolicySnapshot
): string {
  return `[${correlationId}] policy.snapshot [${snapshot.signature}] ${JSON.stringify({
    ...snapshot,
    generatedAt: snapshot.generatedAt.toISOString(),
  })}`;
}

export function formatPatchDeltaArtifact(input: PatchDeltaArtifactInput): string {
  const dryRunCode = formatToolStatusCode(input.dryRunResult);
  const applyCode = formatToolStatusCode(input.applyResult);
  const mutatedPaths = input.applyResult.mutatedPaths.join(',') || input.dryRunResult.mutatedPaths.join(',') || '-';
  return `[${input.correlationId}] patch.delta ${input.subject}: dry-run=${dryRunCode}; apply=${applyCode}; mutatedPaths=${mutatedPaths}`;
}

export function formatApprovalResumeArtifact(
  correlationId: string,
  requestId: string,
  approvalId: string
): string {
  return `[${correlationId}] approval.resume ${requestId} -> ${approvalId}`;
}

export function formatDeferredMutationArtifact(
  correlationId: string,
  changeType: PlannedFileChangeType,
  path: string
): string {
  return `[${correlationId}] deferred-mutation ${changeType} ${path}: mutating file plans require governed tool calls.`;
}

export function formatDeniedToolArtifact(
  correlationId: string,
  subject: string,
  reason: string
): string {
  return `[${correlationId}] denied ${subject}: ${reason}`;
}

export function describePatchSubject(mutatedPaths: string[]): string {
  if (mutatedPaths.length === 0) {
    return 'patch';
  }

  return mutatedPaths.join(', ');
}

export function formatToolFailureReason(result: EngineeringToolResult): string {
  return `${result.summary}${result.error ? `: ${result.error}` : ''}`;
}

export function buildApprovalRequestState(
  correlationId: string,
  result: EngineeringToolResult
): TaskApprovalState {
  let touchedPaths: string[] | undefined;
  let changedLines: number | undefined;

  if (result.output) {
    try {
      const parsed = JSON.parse(result.output) as {
        touchedPaths?: unknown;
        changedLines?: unknown;
      };
      touchedPaths = Array.isArray(parsed.touchedPaths)
        ? parsed.touchedPaths.filter((candidate): candidate is string => typeof candidate === 'string')
        : undefined;
      changedLines = typeof parsed.changedLines === 'number' ? parsed.changedLines : undefined;
    } catch {
      touchedPaths = undefined;
      changedLines = undefined;
    }
  }

  return {
    requestId: correlationId,
    status: 'requested',
    requestedAt: new Date(),
    requestedReason: result.summary,
    touchedPaths,
    changedLines,
  };
}

function formatToolStatusCode(result: EngineeringToolResult): string {
  return result.reasonCode ? `${result.status}/${result.reasonCode}` : result.status;
}
