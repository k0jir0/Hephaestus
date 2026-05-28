export type FailureFamily =
  | 'environment'
  | 'planner'
  | 'repository-policy'
  | 'verification'
  | 'approval'
  | 'unsupported-scope'
  | 'backend'
  | 'unknown';

export interface FailureClassification {
  family: FailureFamily;
  retryable: boolean;
  recommendation: string;
}

const failureRules: Array<{
  family: FailureFamily;
  retryable: boolean;
  patterns: RegExp[];
  recommendation: string;
}> = [
  {
    family: 'unsupported-scope',
    retryable: false,
    patterns: [/unsupported task envelope/i, /unsupported broad/i],
    recommendation: 'Rewrite the ticket into a small supported engineering task before retrying.',
  },
  {
    family: 'environment',
    retryable: true,
    patterns: [/timeout/i, /temporarily/i, /locked/i, /enoent/i, /econnrefused/i, /unavailable/i],
    recommendation: 'Restore the missing local service, file, or lock condition, then retry the same ticket.',
  },
  {
    family: 'backend',
    retryable: true,
    patterns: [/ollama/i, /openai/i, /claude/i, /copilot/i, /model did not/i, /backend/i],
    recommendation: 'Check backend health and credentials; retry after the model endpoint is healthy.',
  },
  {
    family: 'planner',
    retryable: true,
    patterns: [/structured plan validation/i, /json/i, /schema/i, /verification.*must/i],
    recommendation: 'Retry with a narrower prompt or amend the plan so it satisfies the structured contract.',
  },
  {
    family: 'repository-policy',
    retryable: false,
    patterns: [/allowlist/i, /protected path/i, /policy/i, /denied/i, /approval-required/i],
    recommendation: 'Inspect the policy decision; approve explicitly or reduce the patch scope before retrying.',
  },
  {
    family: 'approval',
    retryable: false,
    patterns: [/approval rejected/i, /awaiting approval/i, /requires approval/i],
    recommendation: 'Resolve the human review decision before resuming or retrying this ticket.',
  },
  {
    family: 'verification',
    retryable: true,
    patterns: [/command failed/i, /npm test/i, /npm run/i, /lint/i, /build failed/i],
    recommendation: 'Read the verification output, fix the failing check, and retry with the amended plan.',
  },
];

export function classifyFailureReason(reason: string): FailureClassification {
  for (const rule of failureRules) {
    if (rule.patterns.some((pattern) => pattern.test(reason))) {
      return {
        family: rule.family,
        retryable: rule.retryable,
        recommendation: rule.recommendation,
      };
    }
  }

  return {
    family: 'unknown',
    retryable: false,
    recommendation: 'Escalate to an operator with the attempt artifacts before retrying.',
  };
}

export function formatFailureClassificationArtifact(
  correlationId: string,
  reason: string
): string {
  const classification = classifyFailureReason(reason);
  return [
    `[${correlationId}] failure.classification ${classification.family}`,
    `retryable=${classification.retryable}`,
    `recommendation=${classification.recommendation}`,
  ].join('; ');
}
