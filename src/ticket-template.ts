export interface TicketTemplateAssessment {
  valid: boolean;
  score: number;
  issues: string[];
  recommendation: string;
}

const broadPatterns = [
  /\bdeploy\b/i,
  /\bproduction\b/i,
  /\brewrite\s+(the\s+)?entire\b/i,
  /\bwhole\s+repo\b/i,
  /\beverything\b/i,
];

const actionPattern = /\b(add|apply|capture|fix|implement|improve|optimize|refactor|remove|repair|review|update|validate)\b/i;
const scopePattern = /\b(src\/|test\/|docs\/|scripts\/|README|TASKS\.md|package\.json|runtime|ticket|metrics|ui|model)\b/i;
const verificationPattern = /\b(npm\s+run|npm\s+test|verify|validation|expected|prove|evidence|signal)\b/i;

export function assessTicketTemplate(description: string): TicketTemplateAssessment {
  const normalized = description.trim();
  const issues: string[] = [];
  let score = 0;

  if (normalized.length < 12) {
    issues.push('Description is too short to be a bounded engineering ticket.');
  } else {
    score += 1;
  }

  if (broadPatterns.some((pattern) => pattern.test(normalized))) {
    issues.push('Description appears broad or delivery-oriented; split into local bounded work.');
  } else {
    score += 1;
  }

  if (actionPattern.test(normalized)) {
    score += 1;
  } else {
    issues.push('Description should include an action verb (implement, optimize, refactor, etc.).');
  }

  if (scopePattern.test(normalized)) {
    score += 1;
  } else {
    issues.push('Description should include local scope (file, module, or subsystem).');
  }

  if (verificationPattern.test(normalized)) {
    score += 1;
  } else {
    issues.push('Description should include expected verification signal or command.');
  }

  return {
    valid: issues.length === 0 || (issues.length <= 2 && !issues.some((issue) => /broad|too short/i.test(issue))),
    score,
    issues,
    recommendation:
      'Use: <action> <local scope/file> with <verification command/signal>. Example: "Optimize src/runtime.ts queue scheduling and verify with npm run build".',
  };
}

export function formatTicketTemplateAssessment(assessment: TicketTemplateAssessment): string {
  if (assessment.valid && assessment.issues.length === 0) {
    return `Ticket template quality score=${assessment.score}/5.`;
  }

  return [
    `Ticket template quality score=${assessment.score}/5.`,
    ...assessment.issues.map((issue) => `Issue: ${issue}`),
    `Recommendation: ${assessment.recommendation}`,
  ].join(' ');
}
