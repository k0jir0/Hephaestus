export interface TicketTemplateAssessment {
  valid: boolean;
  score: number;
  issues: string[];
  recommendation: string;
}

import { assessSourceGrounding, sourceGroundingIssueMessage } from './domain/policy/source-grounding-policy.js';

const broadPatterns = [
  /\bdeploy\b/i,
  /\bproduction\b/i,
  /\brewrite\s+(the\s+)?entire\b/i,
  /\bwhole\s+repo\b/i,
  /\beverything\b/i,
  /\bend[-\s]?to[-\s]?end\b/i,
  /\bplatform\b/i,
  /\ball\s+modules\b/i,
  /\ball\s+files\b/i,
];

const actionPattern = /\b(add|apply|capture|fix|implement|improve|optimize|refactor|remove|repair|review|update|validate)\b/i;
const scopePattern = /\b(src\/|test\/|docs\/|scripts\/|README|TASKS\.md|package\.json|runtime|ticket|metrics|ui|model)\b/i;
const deterministicVerificationPattern = /\b(npm\s+test|npm\s+run\s+test|npm\s+run\s+build|npm\s+run\s+lint|npm\s+run\s+validate:config|npm\s+run\s+preflight|npm\s+run\s+start:once|node\s+scripts\/run-tests\.mjs)\b/i;
const expectedSignalPattern = /\bexpected\s+signal\b/i;
const fileScopePattern = /\b(?:src|test|docs|scripts)\/[\w./-]+/gi;

function countFileScopes(description: string): number {
  const matches = description.match(fileScopePattern);
  return matches ? matches.length : 0;
}

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

  if (deterministicVerificationPattern.test(normalized)) {
    score += 1;
  } else {
    issues.push('Description should include one accepted verification command (npm run build/test/lint/validate:config/preflight/start:once or node scripts/run-tests.mjs).');
  }

  if (expectedSignalPattern.test(normalized)) {
    score += 1;
  } else {
    issues.push('Description should include an "expected signal" statement for deterministic validation.');
  }

  const fileScopeCount = countFileScopes(normalized);
  if (fileScopeCount <= 2) {
    score += 1;
  } else {
    issues.push(`Description references ${fileScopeCount} file scopes; split into smaller tickets with <=2 scoped files.`);
  }

  const sourceGrounding = assessSourceGrounding(normalized);
  if (!sourceGrounding.requiresGrounding || sourceGrounding.grounded) {
    score += 1;
  } else {
    issues.push(sourceGroundingIssueMessage());
  }

  return {
    valid: issues.length === 0,
    score,
    issues,
    recommendation:
      'Use: <action> <single scope/file> with one accepted verification command and an expected signal. For blueprint or D2+ work, include one source grounding key (for example ChandyLamport1985 or sources/notes/ChandyLamport1985.md). Example: "Implement D2 replay guard in src/task-store.ts using ChandyLamport1985, verify with npm run test, expected signal: replay test exits 0."',
  };
}

export function formatTicketTemplateAssessment(assessment: TicketTemplateAssessment): string {
  if (assessment.valid && assessment.issues.length === 0) {
    return `Ticket template quality score=${assessment.score}/8.`;
  }

  return [
    `Ticket template quality score=${assessment.score}/8.`,
    ...assessment.issues.map((issue) => `Issue: ${issue}`),
    `Recommendation: ${assessment.recommendation}`,
  ].join(' ');
}
