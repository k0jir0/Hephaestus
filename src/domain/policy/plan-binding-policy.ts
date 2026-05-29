import type { EngineeringToolResult, TaskPlan, ToolPolicySnapshot } from '../../types.js';
import { formatCommandInvocation } from '../plans/command-plan.js';
import { normalizePlanPath } from '../tickets/completion-invariants.js';

export { formatCommandInvocation } from '../plans/command-plan.js';

export type PlanBindingDecisionCode =
  | 'validated-plan-required'
  | 'mutable-intended-file-required'
  | 'patch-path-not-declared'
  | 'command-not-declared'
  | 'read-path-not-declared';

export type PlanBindingPolicyDecision =
  | { allowed: true }
  | {
      allowed: false;
      code: PlanBindingDecisionCode;
      reason: string;
    };

export interface CommandRepairArtifactInput {
  correlationId: string;
  command: string;
  result: EngineeringToolResult;
  plan?: TaskPlan;
  policySnapshot?: ToolPolicySnapshot;
}

const allowedPlanBindingDecision: PlanBindingPolicyDecision = { allowed: true };

function denied(code: PlanBindingDecisionCode, reason: string): PlanBindingPolicyDecision {
  return { allowed: false, code, reason };
}

export function decidePatchPlanBinding(
  plan: TaskPlan | undefined,
  mutatedPaths: string[]
): PlanBindingPolicyDecision {
  if (!plan) {
    return denied('validated-plan-required', 'Patch tool calls require a validated plan.');
  }

  const allowedPaths = new Set(
    plan.intendedFiles
      .filter((file) => file.changeType !== 'inspect')
      .map((file) => normalizePlanPath(file.path))
  );

  if (allowedPaths.size === 0) {
    return denied(
      'mutable-intended-file-required',
      'Patch tool calls require at least one non-inspect intended file in the plan.'
    );
  }

  for (const mutatedPath of mutatedPaths.map((candidate) => normalizePlanPath(candidate))) {
    if (!allowedPaths.has(mutatedPath)) {
      return denied(
        'patch-path-not-declared',
        `Patch touches ${mutatedPath}, which is not declared as a mutable intended file.`
      );
    }
  }

  return allowedPlanBindingDecision;
}

export function validatePatchCallAgainstPlan(
  plan: TaskPlan | undefined,
  mutatedPaths: string[]
): string | null {
  const decision = decidePatchPlanBinding(plan, mutatedPaths);
  return decision.allowed ? null : decision.reason;
}

export function decideCommandPlanBinding(
  plan: TaskPlan | undefined,
  command: string,
  args: string[]
): PlanBindingPolicyDecision {
  if (!plan) {
    return denied('validated-plan-required', 'Command tool calls require a validated plan.');
  }

  const fullCommand = formatCommandInvocation(command, args);
  return plan.commands.some((candidate) => candidate.command === fullCommand)
    ? allowedPlanBindingDecision
    : denied(
        'command-not-declared',
        `Command ${fullCommand} is not declared in the validated plan commands.`
      );
}

export function validateCommandCallAgainstPlan(
  plan: TaskPlan | undefined,
  command: string,
  args: string[]
): string | null {
  const decision = decideCommandPlanBinding(plan, command, args);
  return decision.allowed ? null : decision.reason;
}

export function decideReadPlanBinding(
  plan: TaskPlan | undefined,
  targetPath: string
): PlanBindingPolicyDecision {
  if (!plan) {
    return denied('validated-plan-required', 'File read tool calls require a validated plan.');
  }

  const normalizedTargetPath = normalizePlanPath(targetPath);
  const declaredPaths = plan.intendedFiles.map((candidate) => candidate.path);
  const isDeclared = plan.intendedFiles
    .map((candidate) => normalizePlanPath(candidate.path))
    .includes(normalizedTargetPath);

  if (isDeclared) {
    return allowedPlanBindingDecision;
  }

  const preview = declaredPaths.length > 0
    ? declaredPaths.slice(0, 6).join(', ')
    : 'none';
  return denied(
    'read-path-not-declared',
    `File read target ${targetPath} is not declared in the validated plan. Declared plan files: ${preview}.`
  );
}

export function validateReadCallAgainstPlan(
  plan: TaskPlan | undefined,
  targetPath: string
): string | null {
  const decision = decideReadPlanBinding(plan, targetPath);
  return decision.allowed ? null : decision.reason;
}

export function buildCommandRepairArtifacts(input: CommandRepairArtifactInput): string[] {
  const artifacts: string[] = [];

  if (input.result.reasonCode === 'command-not-allowlisted') {
    const allowlisted = input.policySnapshot?.commandAllowlist.slice(0, 8).join(', ') ?? 'none';
    const plannedCommands = input.plan?.commands.map((entry) => entry.command).join(', ') ?? 'none';
    artifacts.push(
      `[${input.correlationId}] command.repair ${input.command}: denied by allowlist. Allowed commands include: ${allowlisted}. Planned commands: ${plannedCommands}. Rewrite with an allowlisted verification command or escalate.`
    );
    return artifacts;
  }

  if (input.result.status === 'failure') {
    artifacts.push(
      `[${input.correlationId}] command.repair ${input.command}: command failed. Inspect stderr/output artifacts, narrow command scope, and retry with one explicit expected outcome.`
    );
  }

  return artifacts;
}
