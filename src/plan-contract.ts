import fs from 'node:fs';
import path from 'node:path';
import type {
  PlannedCommand,
  PlannedFileChange,
  PlannedFileChangeType,
  Task,
  TaskPlan,
  ToolCall,
  EngineeringToolName,
} from './types.js';
import { supportedTaskEnvelopeSummary } from './task-envelope.js';
import {
  listCommandCatalogEntries,
  resolveCommandCatalogEntry,
} from './domain/policy/command-catalog-policy.js';

const changeTypes: PlannedFileChangeType[] = ['create', 'update', 'delete', 'inspect'];
const changeTypeAliases: Record<string, PlannedFileChangeType> = {
  create: 'create',
  add: 'create',
  new: 'create',
  update: 'update',
  modify: 'update',
  edit: 'update',
  change: 'update',
  delete: 'delete',
  remove: 'delete',
  inspect: 'inspect',
  read: 'inspect',
  review: 'inspect',
  analyze: 'inspect',
};
const executableToolNames: EngineeringToolName[] = [
  'repo.search',
  'file.read',
  'patch.apply',
  'command.run',
];

const toolNameAliases: Record<string, EngineeringToolName> = {
  'repo.search': 'repo.search',
  'search_repo': 'repo.search',
  'search': 'repo.search',
  'file.read': 'file.read',
  'read_file': 'file.read',
  'read': 'file.read',
  'patch.apply': 'patch.apply',
  'apply_patch': 'patch.apply',
  'patch': 'patch.apply',
  'command.run': 'command.run',
  'run_command': 'command.run',
  'run': 'command.run',
};

const textObjectKeys = [
  'step',
  'text',
  'value',
  'description',
  'note',
  'risk',
  'purpose',
  'action',
  'check',
  'expectedOutcome',
  'expected',
  'result',
  'summary',
  'title',
  'content',
  'message',
  'instruction',
];

function normalizeLookupKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const normalizedToolNameAliases = new Map<string, EngineeringToolName>(
  Object.entries(toolNameAliases).map(([key, value]) => [normalizeLookupKey(key), value])
);

const placeholderPathPatterns: readonly RegExp[] = [
  /^src\/example\.[A-Za-z0-9]+$/i,
  /(?:^|\/)example\.[A-Za-z0-9]+$/i,
  /^<.+>$/,
  /replace[_-]?with/i,
  /path\/from\/task-context/i,
  /relative file path from the task context/i,
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Field "${field}" must be a non-empty string.`);
  }

  return value.trim();
}

function assertNoPlaceholderPath(pathValue: string, field: string): string {
  if (placeholderPathPatterns.some((pattern) => pattern.test(pathValue))) {
    throw new Error(
      `Field "${field}" must reference a real repository path, not a placeholder example value.`
    );
  }

  return pathValue;
}

function resolveRepositoryPath(targetProject: string, candidatePath: string, field: string): string {
  const repositoryRoot = path.resolve(targetProject);
  const resolvedPath = path.resolve(repositoryRoot, candidatePath);
  const relativePath = path.relative(repositoryRoot, resolvedPath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error(`Field "${field}" must stay within the target repository.`);
  }

  return resolvedPath;
}

function assertExistingRepositoryPath(
  targetProject: string | undefined,
  candidatePath: string,
  field: string
): string {
  if (!targetProject) {
    return candidatePath;
  }

  const resolvedPath = resolveRepositoryPath(targetProject, candidatePath, field);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(
      `Field "${field}" must reference an existing repository path for this operation.`
    );
  }

  return candidatePath;
}

function requireStringFromKeys(
  value: Record<string, unknown>,
  keys: string[],
  field: string
): string {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }

  throw new Error(`Field "${field}" must be a non-empty string.`);
}

function getOptionalStringFromKeys(
  value: Record<string, unknown>,
  keys: string[],
  field: string
): string | undefined {
  const matchingKey = keys.find((key) => value[key] !== undefined);
  if (!matchingKey) {
    return undefined;
  }

  return requireStringFromKeys(value, keys, field);
}

function getArrayFromKeys(
  value: Record<string, unknown>,
  keys: string[],
  defaultValue: unknown
): unknown {
  for (const key of keys) {
    if (value[key] !== undefined) {
      return value[key];
    }
  }

  return defaultValue;
}

function extractStructuredText(value: unknown, depth = 0): string | null {
  if (typeof value === 'string') {
    const trimmedValue = value.trim();
    return trimmedValue.length === 0 ? null : trimmedValue;
  }

  if (Array.isArray(value)) {
    if (depth >= 2) {
      return null;
    }

    for (const entry of value) {
      const candidate = extractStructuredText(entry, depth + 1);
      if (candidate) {
        return candidate;
      }
    }

    return null;
  }

  if (!isRecord(value) || depth >= 2) {
    return null;
  }

  for (const key of textObjectKeys) {
    const candidate = extractStructuredText(value[key], depth + 1);
    if (candidate) {
      return candidate;
    }
  }

  for (const candidateValue of Object.values(value)) {
    const candidate = extractStructuredText(candidateValue, depth + 1);
    if (candidate) {
      return candidate;
    }
  }

  return null;
}

function stringifyStructuredFallback(value: unknown): string | null {
  if ((isRecord(value) && Object.keys(value).length > 0) || (Array.isArray(value) && value.length > 0)) {
    return JSON.stringify(value);
  }

  return null;
}

function extractTextArrayItem(value: unknown, field: string, index: number): string | null {
  if (typeof value === 'string') {
    const trimmedValue = value.trim();
    return trimmedValue.length === 0 ? null : trimmedValue;
  }

  const extractedText = extractStructuredText(value);
  if (extractedText !== null) {
    return extractedText;
  }

  const serializedFallback = stringifyStructuredFallback(value);
  if (serializedFallback !== null) {
    return serializedFallback;
  }

  throw new Error(`Field "${field}[${index}]" must be a non-empty string.`);
}

function getDefaultFilePurpose(changeType: PlannedFileChangeType, filePath: string): string {
  return `${changeType} ${filePath}`;
}

function getDefaultCommandPurpose(command: string): string {
  return `Run ${command}`;
}

function normalizeChangeType(value: string, field: string): PlannedFileChangeType {
  const normalizedChangeType = changeTypeAliases[normalizeLookupKey(value)] ?? changeTypeAliases[value.trim().toLowerCase()];
  if (!normalizedChangeType) {
    throw new Error(
      `${field} must be one of: ${changeTypes.join(', ')}`
    );
  }

  return normalizedChangeType;
}

function requireStringArray(value: unknown, field: string, allowEmpty: boolean): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`Field "${field}" must be an array of strings.`);
  }

  const items = value.flatMap((item, index) => {
    const normalizedItem = extractTextArrayItem(item, field, index);
    return normalizedItem === null ? [] : [normalizedItem];
  });

  if (!allowEmpty && items.length === 0) {
    throw new Error(`Field "${field}" must contain at least one item.`);
  }

  return items;
}

function parsePlannedFileChange(
  value: unknown,
  index: number,
  targetProject?: string
): PlannedFileChange {
  if (!isRecord(value)) {
    throw new Error(`intendedFiles[${index}] must be an object.`);
  }

  let pathValue = assertNoPlaceholderPath(
    requireString(value.path, `intendedFiles[${index}].path`),
    `intendedFiles[${index}].path`
  );

  const changeType = normalizeChangeType(
    requireStringFromKeys(value, ['changeType', 'type', 'action'], `intendedFiles[${index}].changeType`),
    `intendedFiles[${index}].changeType`
  );

  if (changeType !== 'create') {
    pathValue = assertExistingRepositoryPath(
      targetProject,
      pathValue,
      `intendedFiles[${index}].path`
    );
  }

  let purpose = getDefaultFilePurpose(changeType, pathValue);
  try {
    purpose = requireStringFromKeys(
      value,
      ['purpose', 'description', 'reason', 'why', 'note', 'summary', 'goal', 'intent', 'details', 'action'],
      `intendedFiles[${index}].purpose`
    );
  } catch {
    // Fall back to a deterministic purpose instead of blocking on descriptive-only planner omissions.
  }

  return {
    path: pathValue,
    changeType,
    purpose,
  };
}

function parsePlannedCommand(value: unknown, index: number): PlannedCommand {
  if (!isRecord(value)) {
    throw new Error(`commands[${index}] must be an object.`);
  }

  const commandId = getOptionalStringFromKeys(
    value,
    ['commandId', 'command_id', 'id'],
    `commands[${index}].commandId`
  );

  let command: string;
  const rawCommand = value.command;
  if (typeof rawCommand === 'string' && rawCommand.trim().length > 0) {
    command = rawCommand.trim();
  } else if (commandId) {
    const catalogEntry = resolveCommandCatalogEntry(commandId);
    if (!catalogEntry) {
      throw new Error(`commands[${index}].commandId references unknown command catalog id: ${commandId}`);
    }
    command = [catalogEntry.command, ...catalogEntry.args].join(' ');
  } else {
    throw new Error(`commands[${index}] must provide either commandId or command.`);
  }

  let purpose = getDefaultCommandPurpose(command);
  try {
    purpose = requireStringFromKeys(
      value,
      ['purpose', 'description', 'reason', 'why', 'note', 'summary', 'goal', 'intent', 'details'],
      `commands[${index}].purpose`
    );
  } catch {
    // Defaulting keeps otherwise valid verification commands executable.
  }

  return {
    commandId,
    command,
    purpose,
    expectedOutcome: getOptionalStringFromKeys(
      value,
      ['expectedOutcome', 'outcome', 'successCriteria', 'success', 'expected', 'result'],
      `commands[${index}].expectedOutcome`
    ),
  };
}

function parseToolCall(value: unknown, index: number, targetProject?: string): ToolCall {
  if (!isRecord(value)) {
    throw new Error(`toolCalls[${index}] must be an object.`);
  }

  const nameRaw = requireStringFromKeys(value, ['name', 'tool'], `toolCalls[${index}].name`);
  const nameKey = normalizeLookupKey(nameRaw);
  const mapped = normalizedToolNameAliases.get(nameKey) ?? toolNameAliases[nameRaw] ?? undefined;
  const finalName = mapped ?? (executableToolNames.includes(nameRaw as EngineeringToolName) ? (nameRaw as EngineeringToolName) : undefined);
  if (!finalName) {
    throw new Error(
      `toolCalls[${index}].name must be one of: ${executableToolNames.join(', ')}`
    );
  }

  const argumentsValue = getArrayFromKeys(value, ['arguments', 'args', 'input'], undefined);
  if (!isRecord(argumentsValue)) {
    throw new Error(`toolCalls[${index}].arguments must be an object.`);
  }

  if (finalName === 'file.read' && typeof argumentsValue.path === 'string') {
    argumentsValue.path = assertNoPlaceholderPath(
      requireString(argumentsValue.path, `toolCalls[${index}].arguments.path`),
      `toolCalls[${index}].arguments.path`
    );
    argumentsValue.path = assertExistingRepositoryPath(
      targetProject,
      argumentsValue.path,
      `toolCalls[${index}].arguments.path`
    );
  }

  return {
    name: finalName,
    arguments: argumentsValue,
  };
}

function extractJsonPayload(rawContent: string): string {
  const trimmed = rawContent.trim();
  const fencedMatch = trimmed.match(/^```(?:json)?\s*([\s\S]+?)\s*```$/i);
  if (fencedMatch) {
    return fencedMatch[1].trim();
  }

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error('Model response did not contain a JSON object.');
  }

  return trimmed.slice(firstBrace, lastBrace + 1);
}

export function buildStructuredPlanPrompt(task: Task, context: string | undefined, targetProject: string): string {
  const contextSection = context
    ? `Context:\n${context}\n\n`
    : '';

  const commandCatalogEntries = listCommandCatalogEntries();
  const commandCatalogSummary = commandCatalogEntries
    .map((entry) => `${entry.id} => ${[entry.command, ...entry.args].join(' ')}`)
    .join('; ');

  return [
    `Task: ${task.description}`,
    '',
    contextSection,
    `Project path: ${targetProject}`,
    '',
    'Return a single JSON object with this exact shape:',
    '{',
    '  "summary": "one-sentence summary of the planned work",',
    '  "intendedFiles": [',
    '    { "path": "<relative file path from the task context>", "changeType": "update", "purpose": "why this file matters" }',
    '  ],',
    '  "commands": [',
    '    { "commandId": "npm.test", "command": "npm test", "purpose": "what this command validates", "expectedOutcome": "what success looks like" }',
    '  ],',
    '  "toolCalls": [',
    '    { "name": "file.read", "arguments": { "path": "<relative file path from the task context>", "startLine": 1, "endLine": 40 } }',
    '  ],',
    '  "verification": ["at least one verification step"],',
    '  "risks": ["optional risk or dependency notes"]',
    '}',
    '',
    'Rules:',
    `- ${supportedTaskEnvelopeSummary()}`,
    '- Return JSON only. Do not wrap it in markdown unless the client forces it.',
    '- Use relative file paths when possible.',
    '- Never copy placeholder example paths; every non-create path must name a real repository file relevant to the task.',
    '- Keep commands limited to the smallest useful set.',
    '- Prefer command IDs from the command catalog when possible and include commandId with each command.',
    `- Command catalog IDs: ${commandCatalogSummary}.`,
    '- If no files need changes, return an empty intendedFiles array.',
    '- If no commands are needed, return an empty commands array.',
    '- toolCalls may be empty when execution should remain plan-only.',
    `- Valid toolCalls.name values are exactly: ${executableToolNames.join(', ')}.`,
    '- Do not emit delivery or source-control actions such as git.branch, git.commit, or github.pr; this runtime keeps delivery outside the local execution envelope.',
    '- Only include toolCalls that are justified by the intendedFiles or commands in the same plan.',
    '- If intendedFiles contains any create, update, or delete entries, include matching governed toolCalls for those mutations instead of relying on plan-only file lists.',
    '- Use command.run only for safe verification commands that already exist in package.json: npm test, npm run test, npm run build, npm run validate:config, npm run preflight, npm run start:once, npm run tickets, npm run lint.',
    '- Do not use npm update, npm run start, npm run start:daemon, stop scripts, taskkill, or other process-management commands as verification commands.',
    '- verification must always contain at least one step.',
    '- risks may be empty when there are no meaningful risks.',
  ].join('\n');
}

export function getStructuredPlanSystemPrompt(): string {
  return [
    'You are Hephaestus, an autonomous AI developer agent.',
    'Produce a typed execution plan before any code changes are applied.',
    'Return valid JSON that matches the requested schema exactly.',
    'Do not include prose outside the JSON object.',
  ].join(' ');
}

export function parseTaskPlan(rawContent: string, targetProject?: string): TaskPlan {
  return parseStructuredExecutionResponse(rawContent, targetProject).plan;
}

export function parseStructuredExecutionResponse(
  rawContent: string,
  targetProject?: string
): {
  plan: TaskPlan;
  toolCalls: ToolCall[];
} {
  const payload = extractJsonPayload(rawContent);
  const parsed = JSON.parse(payload) as unknown;

  if (!isRecord(parsed)) {
    throw new Error('Plan response must be a JSON object.');
  }

  const intendedFilesRaw = getArrayFromKeys(parsed, ['intendedFiles', 'files'], undefined);
  if (!Array.isArray(intendedFilesRaw)) {
    throw new Error('Field "intendedFiles" must be an array.');
  }

  const commandsRaw = getArrayFromKeys(parsed, ['commands', 'verificationCommands'], undefined);
  if (!Array.isArray(commandsRaw)) {
    throw new Error('Field "commands" must be an array.');
  }

  const toolCallsRaw = getArrayFromKeys(parsed, ['toolCalls', 'tools'], undefined);
  if (toolCallsRaw !== undefined && !Array.isArray(toolCallsRaw)) {
    throw new Error('Field "toolCalls" must be an array when present.');
  }

  const verificationRaw = getArrayFromKeys(
    parsed,
    ['verification', 'verificationSteps', 'verifications', 'checks', 'validation', 'validations'],
    undefined
  );

  const risksRaw = getArrayFromKeys(parsed, ['risks', 'riskNotes', 'considerations'], []);

  return {
    plan: {
      summary: requireString(parsed.summary, 'summary'),
      intendedFiles: intendedFilesRaw.map((value, index) => parsePlannedFileChange(value, index, targetProject)),
      commands: commandsRaw.map((value, index) => parsePlannedCommand(value, index)),
      verification: requireStringArray(verificationRaw, 'verification', false),
      risks: requireStringArray(risksRaw, 'risks', true),
    },
    toolCalls: (toolCallsRaw ?? []).map((value, index) => parseToolCall(value, index, targetProject)),
  };
}

export function formatTaskPlanSummary(plan: TaskPlan): string {
  return `${plan.summary} Planned files: ${plan.intendedFiles.length}. Commands: ${plan.commands.length}. Verification steps: ${plan.verification.length}.`;
}
