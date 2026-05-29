import type { TaskPlan } from '../../types.js';

export function normalizePlanPath(candidate: string): string {
  return candidate.replace(/\\/g, '/').trim().toLowerCase();
}

export function validateCompletionMutationEvidence(
  plan: TaskPlan | undefined,
  observedMutatedPaths: string[]
): string | null {
  if (!plan) {
    return null;
  }

  const plannedMutablePaths = plan.intendedFiles
    .filter((file) => file.changeType !== 'inspect')
    .map((file) => normalizePlanPath(file.path));

  if (plannedMutablePaths.length === 0) {
    return null;
  }

  const observedSet = new Set(observedMutatedPaths.map((candidate) => normalizePlanPath(candidate)));
  if (observedSet.size === 0) {
    return `No governed mutation evidence was recorded for mutable intended files (${plannedMutablePaths.join(', ')}). Completion requires at least one applied mutation in declared targets.`;
  }

  const hasPlannedMutation = plannedMutablePaths.some((candidate) => observedSet.has(candidate));
  if (!hasPlannedMutation) {
    return `Observed mutations (${Array.from(observedSet).join(', ')}) do not intersect mutable intended files (${plannedMutablePaths.join(', ')}). Completion requires declared-target mutations.`;
  }

  return null;
}
