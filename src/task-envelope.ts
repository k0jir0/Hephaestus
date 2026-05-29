import { assessSourceGrounding, sourceGroundingIssueMessage } from './domain/policy/source-grounding-policy.js';

export type SupportedTaskClass =
  | 'focused-code-change'
  | 'test-repair'
  | 'configuration-repair'
  | 'documentation-update'
  | 'ci-repair'
  | 'repository-inspection';

export interface TaskEnvelopeDecision {
  supported: boolean;
  taskClass: SupportedTaskClass | 'unsupported';
  reason: string;
  recommendation: string;
}

export interface TaskEnvelopeQualityLint {
  score: number;
  actionable: boolean;
  issues: string[];
  recommendation: string;
}

const unsupportedPatterns = [
  /\bdeploy\b/i,
  /\bproduction\b/i,
  /\brewrite\s+(the\s+)?entire\b/i,
  /\brebuild\s+(the\s+)?whole\b/i,
  /\bunbounded\b/i,
  /\bopen\s+(a\s+)?pull\s+request\b/i,
  /\bmerge\s+(this|the)\b/i,
  /\bpublish\s+(to|the)\b/i,
  /\bdelete\s+all\b/i,
];

const classPatterns: Array<{ taskClass: SupportedTaskClass; patterns: RegExp[]; reason: string }> = [
  {
    taskClass: 'test-repair',
    patterns: [/\bfix\b.*\btest\b/i, /\bfailing\s+test/i, /\bregression\s+test/i],
    reason: 'The task targets bounded test failure or regression work.',
  },
  {
    taskClass: 'configuration-repair',
    patterns: [/\bconfig(uration)?\b/i, /\bpath\b/i, /\benv\b/i, /\bsetting\b/i],
    reason: 'The task targets a local configuration or path repair.',
  },
  {
    taskClass: 'documentation-update',
    patterns: [/\bdoc(s|umentation)?\b/i, /\breadme\b/i, /\babout\b/i],
    reason: 'The task targets documentation or product-description updates.',
  },
  {
    taskClass: 'ci-repair',
    patterns: [/\bci\b/i, /\bworkflow\b/i, /\bgithub actions\b/i, /\blint\b/i, /\bbuild\b/i],
    reason: 'The task targets build, lint, or CI repair.',
  },
  {
    taskClass: 'repository-inspection',
    patterns: [/\binspect\b/i, /\baudit\b/i, /\banaly[sz]e\b/i, /\bsearch\b/i, /\btriage\b/i],
    reason: 'The task targets repository inspection or triage.',
  },
  {
    taskClass: 'focused-code-change',
    patterns: [
      /\badd\b/i,
      /\bapply\b/i,
      /\bcapture\b/i,
      /\bfix\b/i,
      /\bimplement\b/i,
      /\bplan\b/i,
      /\brepair\b/i,
      /\bresume\b/i,
      /\bupdate\b/i,
      /\brefactor\b/i,
      /\bship\b/i,
      /\bendpoint\b/i,
      /\bfeature\b/i,
      /\broadmap\b/i,
    ],
    reason: 'The task is phrased as a bounded local code change.',
  },
];

export function classifyTaskEnvelope(description: string): TaskEnvelopeDecision {
  const normalizedDescription = description.trim();
  if (!normalizedDescription) {
    return unsupported('Task description is empty.');
  }

  const unsupportedPattern = unsupportedPatterns.find((pattern) => pattern.test(normalizedDescription));
  if (unsupportedPattern) {
    return unsupported(
      `The task matches an unsupported broad or delivery-oriented pattern: ${unsupportedPattern.source}.`
    );
  }

  const sourceGrounding = assessSourceGrounding(normalizedDescription);
  if (sourceGrounding.requiresGrounding && !sourceGrounding.grounded) {
    return unsupported(sourceGroundingIssueMessage());
  }

  for (const candidate of classPatterns) {
    if (candidate.patterns.some((pattern) => pattern.test(normalizedDescription))) {
      return {
        supported: true,
        taskClass: candidate.taskClass,
        reason: candidate.reason,
        recommendation: 'Proceed with bounded planning, governed tool calls, and explicit verification evidence.',
      };
    }
  }

  return unsupported('The task does not clearly fit a supported bounded engineering task class.');
}

export function formatTaskEnvelopeDecision(decision: TaskEnvelopeDecision): string {
  return [
    `Unsupported task envelope: ${decision.reason}`,
    `Recommendation: ${decision.recommendation}`,
  ].join(' ');
}

export function supportedTaskEnvelopeSummary(): string {
  return [
    'Supported task classes: focused-code-change, test-repair, configuration-repair, documentation-update, ci-repair, repository-inspection.',
    'Blueprint/D2+ tickets must include source grounding (source key or sources/notes/... path).',
    'Defer deployment, merge, PR-opening, broad rewrite, production-operation, and unclear unbounded tasks to an operator.',
  ].join(' ');
}

export function lintTaskEnvelopeQuality(description: string): TaskEnvelopeQualityLint {
  const normalized = description.trim();
  const issues: string[] = [];
  let score = 0;

  if (normalized.length >= 12) {
    score += 1;
  } else {
    issues.push('Description is too short to scope bounded implementation work.');
  }

  if (unsupportedPatterns.some((pattern) => pattern.test(normalized))) {
    issues.push('Description includes broad delivery or production language that should be split.');
  } else {
    score += 1;
  }

  if (/\b(add|fix|implement|optimi[sz]e|refactor|remove|update|validate)\b/i.test(normalized)) {
    score += 1;
  } else {
    issues.push('Description should include a concrete action verb.');
  }

  if (/\b(src\/|test\/|docs\/|scripts\/|runtime|ticket|metrics|ui|model)\b/i.test(normalized)) {
    score += 1;
  } else {
    issues.push('Description should identify local scope (file, module, or subsystem).');
  }

  if (/\b(npm\s+run|npm\s+test|verify|validation|evidence|signal)\b/i.test(normalized)) {
    score += 1;
  } else {
    issues.push('Description should include a verification command or expected signal.');
  }

  const sourceGrounding = assessSourceGrounding(normalized);
  if (sourceGrounding.requiresGrounding && !sourceGrounding.grounded) {
    issues.push(sourceGroundingIssueMessage());
  }

  return {
    score,
    actionable: issues.length <= 2,
    issues,
    recommendation:
      'Use: <action> <local scope> with <verification signal>. Example: "Implement src/task-store.ts dispatch pacing and verify with npm run build".',
  };
}

function unsupported(reason: string): TaskEnvelopeDecision {
  return {
    supported: false,
    taskClass: 'unsupported',
    reason,
    recommendation:
      'Split the work into a small local engineering ticket with explicit files, expected behavior, and verification steps.',
  };
}
