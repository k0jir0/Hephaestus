export interface RankedContextCandidate {
  path: string;
  score: number;
  reasons: string[];
}

const weakTokens = new Set([
  'a',
  'an',
  'and',
  'for',
  'from',
  'in',
  'into',
  'of',
  'on',
  'the',
  'to',
  'with',
]);

export function rankContextCandidates(
  taskDescription: string,
  fileIndex: string[],
  limit = 12
): RankedContextCandidate[] {
  const tokens = tokenizeTask(taskDescription);
  const intentHints = detectIntentHints(taskDescription);
  const ranked = fileIndex.map((filePath) => scoreCandidate(filePath, tokens, intentHints));

  return ranked
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path))
    .slice(0, limit);
}

export function formatRankedContextCandidates(candidates: RankedContextCandidate[]): string {
  return candidates
    .map((candidate) => {
      const reasons = candidate.reasons.length > 0 ? ` (${candidate.reasons.join(', ')})` : '';
      return `- ${candidate.path} score=${candidate.score}${reasons}`;
    })
    .join('\n');
}

function scoreCandidate(
  filePath: string,
  tokens: string[],
  intentHints: Set<string>
): RankedContextCandidate {
  const normalizedPath = filePath.replace(/\\/g, '/').toLowerCase();
  const basename = normalizedPath.split('/').pop() ?? normalizedPath;
  let score = 0;
  const reasons = new Set<string>();

  for (const token of tokens) {
    if (basename.includes(token)) {
      score += 5;
      reasons.add(`basename:${token}`);
    } else if (normalizedPath.includes(token)) {
      score += 2;
      reasons.add(`path:${token}`);
    }
  }

  if (intentHints.has('test') && /(^|\/)(test|tests)\//.test(normalizedPath)) {
    score += 4;
    reasons.add('test-hint');
  }

  if (intentHints.has('documentation') && /(^|\/)(docs|readme|architecture)/.test(normalizedPath)) {
    score += 4;
    reasons.add('docs-hint');
  }

  if (intentHints.has('ui') && /(ui|frontend|view|server)/.test(normalizedPath)) {
    score += 4;
    reasons.add('ui-hint');
  }

  if (intentHints.has('runtime') && /(runtime|executor|tool-runtime|task-store)/.test(normalizedPath)) {
    score += 4;
    reasons.add('runtime-hint');
  }

  if (intentHints.has('config') && /(config|env|preflight)/.test(normalizedPath)) {
    score += 4;
    reasons.add('config-hint');
  }

  return {
    path: filePath,
    score,
    reasons: [...reasons],
  };
}

function tokenizeTask(taskDescription: string): string[] {
  return [...new Set(
    taskDescription
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3 && !weakTokens.has(token))
  )];
}

function detectIntentHints(taskDescription: string): Set<string> {
  const lower = taskDescription.toLowerCase();
  const hints = new Set<string>();

  if (/\b(test|tests|ci|lint|failing|failure|regression)\b/.test(lower)) {
    hints.add('test');
  }

  if (/\b(doc|docs|readme|paper|architecture|about)\b/.test(lower)) {
    hints.add('documentation');
  }

  if (/\b(ui|frontend|screen|page|layout|button|browser)\b/.test(lower)) {
    hints.add('ui');
  }

  if (/\b(runtime|executor|tool|ticket|queue|attempt|agent)\b/.test(lower)) {
    hints.add('runtime');
  }

  if (/\b(config|env|preflight|startup|launch)\b/.test(lower)) {
    hints.add('config');
  }

  return hints;
}
