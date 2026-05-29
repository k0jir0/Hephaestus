export const defaultTransientFailureAttemptCap = 2;

export const likelyTransientFailurePatterns: readonly RegExp[] = [
  /\btimeout\b/i,
  /\betimedout\b/i,
  /\beconnreset\b/i,
  /\bebusy\b/i,
  /\btemporar(il)?y\b/i,
  /\btransient\b/i,
  /\brate\s*limit\b/i,
  /\bbackend\s+unavailable\b/i,
  /\bwarmup\b/i,
];

export const hardBlockFailurePatterns: readonly RegExp[] = [
  /unsupported task envelope/i,
  /allowlisted/i,
  /denied/i,
  /invalid\s+task\s+transition/i,
  /approval\s+required/i,
];

export const globalErrorBudgetExclusionPatterns: readonly RegExp[] = [
  /is not declared in the validated plan/i,
  /is not declared in the validated plan commands/i,
  /no governed mutation evidence/i,
  /do not intersect mutable intended files/i,
  /requires at least one non-inspect intended file/i,
  /patch touches .* not declared/i,
];

export interface TaskFailurePolicyInput {
  reason: string;
  attemptCount?: number;
  forceBlocked?: boolean;
  maxTransientFailures?: number;
}

export interface TaskFailurePolicyDecision {
  countAgainstGlobalErrorBudget: boolean;
  hardBlocked: boolean;
}

export type TaskFailureStatus = 'blocked' | 'failed';
export type RuntimeFailureStatus = 'blocked' | 'error';
export type MemoryFailureStatus = 'Blocked' | 'Failed';

export function resolveTransientFailureAttemptCap(candidate: number): number {
  return Number.isInteger(candidate)
    ? Math.max(1, candidate)
    : defaultTransientFailureAttemptCap;
}

export function shouldCountAgainstGlobalErrorBudget(reason: string): boolean {
  return !globalErrorBudgetExclusionPatterns.some((pattern) => pattern.test(reason));
}

export function shouldEscalateToBlocked(input: TaskFailurePolicyInput): boolean {
  if (input.forceBlocked === true) {
    return true;
  }

  if (hardBlockFailurePatterns.some((pattern) => pattern.test(input.reason))) {
    return true;
  }

  const maxTransientFailures = resolveTransientFailureAttemptCap(
    input.maxTransientFailures ?? defaultTransientFailureAttemptCap
  );
  const attemptsUsed = input.attemptCount ?? 0;
  if (attemptsUsed >= maxTransientFailures) {
    return true;
  }

  return !likelyTransientFailurePatterns.some((pattern) => pattern.test(input.reason));
}

export function decideTaskFailure(input: TaskFailurePolicyInput): TaskFailurePolicyDecision {
  return {
    countAgainstGlobalErrorBudget: shouldCountAgainstGlobalErrorBudget(input.reason),
    hardBlocked: shouldEscalateToBlocked(input),
  };
}

export function resolveTaskFailureStatus(hardBlocked: boolean): TaskFailureStatus {
  return hardBlocked ? 'blocked' : 'failed';
}

export function resolveRuntimeFailureStatus(hardBlocked: boolean): RuntimeFailureStatus {
  return hardBlocked ? 'blocked' : 'error';
}

export function resolveMemoryFailureStatus(hardBlocked: boolean): MemoryFailureStatus {
  return hardBlocked ? 'Blocked' : 'Failed';
}

export function shouldReturnToIdleAfterFailure(hardBlocked: boolean): boolean {
  return !hardBlocked;
}
