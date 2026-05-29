export interface SourceGroundingAssessment {
  requiresGrounding: boolean;
  grounded: boolean;
}

export const SOURCE_GROUNDING_KEYS = [
  'ChandyLamport1985',
  'Helland2015',
  'Helland2007LifeBeyondDistributedTransactions',
  'Verraes2019',
  'Yang2024SWEAgent',
  'Zhang2023RepoCoder',
  'Schick2023Toolformer',
  'Yao2023ReAct',
  'Shinn2023Reflexion',
  'Madaan2023SelfRefine',
  'Xia2024Agentless',
  'Zhang2024AutoCodeRover',
  'Bairi2023CodePlan',
  'Liu2024STALLPlus',
  'Ding2026SWEReplay',
  'Tao2024MAGIS',
  'Endsley1995',
  'LeeSee2004',
  'Woods1996',
  'LevesonThomas2018STPAHandbook',
  'Amodei2016',
  'ClaessenHughes2000',
  'FooteYoder1997BigBallOfMud',
] as const;

const blueprintPhasePattern = /\b(?:blueprint|D(?:2|3|4|5|6)\+?)\b/i;
const sourceGroundingPattern = new RegExp(
  `\\b(?:sources\\/notes\\/[\\w.-]+\\.md|sources\\/library-catalog\\.md|sources\\/acquisition-manifest\\.md|${SOURCE_GROUNDING_KEYS.join(
    '|'
  )})\\b`,
  'i'
);
const notePathPattern = /sources\/notes\/([\w.-]+)\.md/gi;

export function assessSourceGrounding(description: string): SourceGroundingAssessment {
  const normalized = description.trim();
  return {
    requiresGrounding: blueprintPhasePattern.test(normalized),
    grounded: sourceGroundingPattern.test(normalized),
  };
}

export function extractSourceGroundingKeys(description: string): string[] {
  const normalized = description.trim();
  const found = new Set<string>();

  for (const key of SOURCE_GROUNDING_KEYS) {
    const keyPattern = new RegExp(`\\b${key}\\b`, 'i');
    if (keyPattern.test(normalized)) {
      found.add(key);
    }
  }

  let match = notePathPattern.exec(normalized);
  while (match) {
    const fromPath = match[1];
    if (fromPath && SOURCE_GROUNDING_KEYS.includes(fromPath as (typeof SOURCE_GROUNDING_KEYS)[number])) {
      found.add(fromPath);
    }
    match = notePathPattern.exec(normalized);
  }

  return [...found];
}

export function sourceGroundingIssueMessage(): string {
  return 'Blueprint/D2+ tickets should include source grounding (for example a note key like ChandyLamport1985 or a sources/notes/... path).';
}
