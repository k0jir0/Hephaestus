import fs from 'node:fs/promises';
import path from 'node:path';
import { config as defaultConfig, type Config } from './config.js';
import {
  createBackendClient,
  type AIBackendClient,
  type AIBackendClientDependencies,
} from './executor-backends.js';
import { createComponentLogger } from './logger.js';
import type { TaskStatus, TaskTicket } from './types.js';

const logger = createComponentLogger('SelfAudit');
const excludedDirectories = new Set([
  '.git',
  'node_modules',
  'dist',
  'coverage',
  'logs',
  'run',
  'target',
  '.next',
  '.turbo',
]);
const activeStatuses = new Set<TaskStatus>([
  'pending',
  'in_progress',
  'planned',
  'awaiting_approval',
  'applying',
  'verifying',
  'blocked',
  'failed',
]);
const actionableVerbs = [
  'add',
  'align',
  'build',
  'create',
  'document',
  'enforce',
  'extend',
  'expose',
  'fix',
  'harden',
  'implement',
  'improve',
  'introduce',
  'normalize',
  'persist',
  'provide',
  'reconcile',
  'refactor',
  'remove',
  'repair',
  'require',
  'seed',
  'stabilize',
  'support',
  'test',
  'update',
  'validate',
  'wire',
];
const defaultTicketLimit = 5;
const maxSnapshotEntries = 160;
const maxReadBytes = 8 * 1024;

export interface SelfAuditTicketRepository {
  listTickets(status?: TaskStatus | 'all'): Promise<TaskTicket[]>;
  createTicket(description: string): Promise<{ id: string; status: TaskStatus; description: string }>;
}

export type SelfAuditPriority = 'high' | 'medium' | 'low';

export interface SelfAuditFinding {
  title: string;
  priority: SelfAuditPriority;
  area: string;
  rationale: string;
  evidence: string[];
  acceptance: string[];
}

export interface SelfAuditSeedOptions {
  limit?: number;
  dryRun?: boolean;
  onlyWhenQueueEmpty?: boolean;
}

export interface SelfAuditSeedResult {
  summary: string;
  findings: SelfAuditFinding[];
  created: Array<{ id: string; description: string }>;
  skippedDuplicates: string[];
  skippedBecauseQueueActive: boolean;
  rawContent: string;
}

export interface SelfAuditDependencies extends Omit<AIBackendClientDependencies, 'config'> {
  config?: Config;
  repository: SelfAuditTicketRepository;
  backendClient?: AIBackendClient;
  snapshotProvider?: () => Promise<string>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Field "${field}" must be a non-empty string.`);
  }

  return value.trim();
}

function getStringFromKeys(
  value: Record<string, unknown>,
  keys: string[],
  field: string,
  fallback?: string
): string {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }

  if (fallback !== undefined) {
    return fallback;
  }

  throw new Error(`Field "${field}" must be a non-empty string.`);
}

function extractTextArrayItem(value: unknown, field: string, index: number): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
  }

  if (isRecord(value)) {
    for (const key of ['text', 'value', 'description', 'note', 'step', 'item']) {
      const candidate = value[key];
      if (typeof candidate === 'string' && candidate.trim().length > 0) {
        return candidate.trim();
      }
    }
  }

  throw new Error(`Field "${field}[${index}]" must be a non-empty string.`);
}

function parseStringArray(value: unknown, field: string): string[] {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error(`Field "${field}" must be an array of strings.`);
  }

  return value.flatMap((item, index) => {
    const normalized = extractTextArrayItem(item, field, index);
    return normalized === null ? [] : [normalized];
  });
}

function normalizePriority(value: unknown): SelfAuditPriority {
  if (typeof value !== 'string') {
    return 'medium';
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'high' || normalized === 'medium' || normalized === 'low') {
    return normalized;
  }

  if (normalized === 'critical') {
    return 'high';
  }

  return 'medium';
}

function extractJsonPayload(rawContent: string): string {
  const trimmed = rawContent.trim();
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]+?)\s*```/i);
  if (fencedMatch) {
    return fencedMatch[1].trim();
  }

  const firstBrace = trimmed.indexOf('{');
  const firstBracket = trimmed.indexOf('[');
  if (firstBrace === -1 && firstBracket === -1) {
    throw new Error('Model response did not contain JSON.');
  }

  if (firstBracket !== -1 && (firstBrace === -1 || firstBracket < firstBrace)) {
    const lastBracket = trimmed.lastIndexOf(']');
    if (lastBracket === -1 || lastBracket <= firstBracket) {
      throw new Error('Model response did not contain a valid JSON array.');
    }

    return trimmed.slice(firstBracket, lastBracket + 1);
  }

  const lastBrace = trimmed.lastIndexOf('}');
  if (lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error('Model response did not contain a valid JSON object.');
  }

  return trimmed.slice(firstBrace, lastBrace + 1);
}

function sanitizeArea(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized || 'general';
}

function formatTicketDescription(finding: SelfAuditFinding): string {
  return `Self-audit [${finding.priority}/${sanitizeArea(finding.area)}]: ${finding.title}`;
}

function normalizeTicketIdentity(description: string): string {
  return description
    .toLowerCase()
    .replace(/^self-audit\s*(?:\[[^\]]+\]|\([^\)]+\))\s*:\s*/i, '')
    .replace(/^self-audit\s*:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeLimit(limit: number | undefined): number {
  if (!Number.isInteger(limit) || (limit ?? 0) <= 0) {
    return defaultTicketLimit;
  }

  return Math.min(limit ?? defaultTicketLimit, 10);
}

function looksActionable(title: string): boolean {
  const normalized = title.trim().toLowerCase();
  return actionableVerbs.some((verb) => normalized.startsWith(`${verb} `));
}

function parseFinding(value: unknown, index: number): SelfAuditFinding {
  if (typeof value === 'string') {
    const title = requireString(value, `tickets[${index}]`);
    return {
      title,
      priority: 'medium',
      area: 'general',
      rationale: title,
      evidence: [],
      acceptance: [],
    };
  }

  if (!isRecord(value)) {
    throw new Error(`tickets[${index}] must be an object.`);
  }

  const title = getStringFromKeys(value, ['title', 'summary', 'description', 'ticket'], `tickets[${index}].title`);
  return {
    title,
    priority: normalizePriority(value.priority ?? value.severity),
    area: getStringFromKeys(value, ['area', 'category', 'theme'], `tickets[${index}].area`, 'general'),
    rationale: getStringFromKeys(value, ['rationale', 'reason', 'why', 'summary'], `tickets[${index}].rationale`, title),
    evidence: parseStringArray(value.evidence, `tickets[${index}].evidence`),
    acceptance: parseStringArray(value.acceptance, `tickets[${index}].acceptance`),
  };
}

function parseFallbackFindings(rawContent: string, limit: number): SelfAuditFinding[] {
  const lines = rawContent
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const findings: SelfAuditFinding[] = [];
  for (const line of lines) {
    const bulletMatch = line.match(/^(?:[-*+]|\d+[.)])\s+(.+)$/);
    const priorityMatch = line.match(/^(high|medium|low|critical)\s*[:\-]\s*(.+)$/i);
    const candidate = bulletMatch?.[1] ?? priorityMatch?.[2];
    if (!candidate) {
      continue;
    }

    const title = candidate
      .replace(/^["'`]+|["'`]+$/g, '')
      .replace(/\s*\((?:priority|prio)\s*[:#-]?\s*\d+\)\s*$/i, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (title.length === 0) {
      continue;
    }

    findings.push({
      title,
      priority: normalizePriority(priorityMatch?.[1]),
      area: 'general',
      rationale: title,
      evidence: [],
      acceptance: [],
    });

    if (findings.length >= limit) {
      break;
    }
  }

  return findings;
}

function parseAuditResponse(rawContent: string, limit: number): { summary: string; findings: SelfAuditFinding[] } {
  try {
    const payload = extractJsonPayload(rawContent);
    const parsed = JSON.parse(payload) as unknown;
    const summary = isRecord(parsed) && typeof parsed.summary === 'string' ? parsed.summary.trim() : 'Self-audit ticket seed';
    const ticketsValue = Array.isArray(parsed)
      ? parsed
      : isRecord(parsed) && Array.isArray(parsed.tickets)
        ? parsed.tickets
        : null;

    if (!ticketsValue) {
      throw new Error('Self-audit response must be a JSON array or an object with a tickets array.');
    }

    const findings = ticketsValue
      .map((item, index) => parseFinding(item, index))
      .filter((finding) => looksActionable(finding.title))
      .slice(0, limit);
    if (findings.length === 0) {
      throw new Error('Self-audit response did not include any tickets.');
    }

    return { summary, findings };
  } catch {
    const findings = parseFallbackFindings(rawContent, limit).filter((finding) => looksActionable(finding.title));
    if (findings.length === 0) {
      throw new Error('Model response did not contain JSON or a recognizable ticket list.');
    }

    return {
      summary: 'Self-audit ticket seed',
      findings,
    };
  }
}

async function readSnippet(filePath: string, maxBytes = maxReadBytes): Promise<string | null> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return content.slice(0, maxBytes).trim();
  } catch {
    return null;
  }
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function walkDirectory(rootDir: string, currentDir: string, entries: string[], depth: number): Promise<void> {
  if (entries.length >= maxSnapshotEntries || depth > 3) {
    return;
  }

  const dirEntries = await fs.readdir(currentDir, { withFileTypes: true });
  dirEntries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of dirEntries) {
    if (entries.length >= maxSnapshotEntries) {
      return;
    }

    if (entry.name.startsWith('.') && entry.name !== '.github') {
      continue;
    }

    const fullPath = path.join(currentDir, entry.name);
    const relativePath = path.relative(rootDir, fullPath).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      if (excludedDirectories.has(entry.name)) {
        continue;
      }

      entries.push(`${relativePath}/`);
      await walkDirectory(rootDir, fullPath, entries, depth + 1);
      continue;
    }

    entries.push(relativePath);
  }
}

export class SelfAuditSeeder {
  private readonly runtimeConfig: Config;
  private readonly repository: SelfAuditTicketRepository;
  private readonly backendClient: AIBackendClient;
  private readonly snapshotProvider: () => Promise<string>;

  constructor(dependencies: SelfAuditDependencies) {
    this.runtimeConfig = dependencies.config ?? defaultConfig;
    this.repository = dependencies.repository;
    this.backendClient = dependencies.backendClient ?? createBackendClient({
      config: this.runtimeConfig,
      execFileRunner: dependencies.execFileRunner,
      fetchImpl: dependencies.fetchImpl,
    });
    this.snapshotProvider = dependencies.snapshotProvider ?? (() => this.buildRepositorySnapshot());
  }

  async seedTickets(options: SelfAuditSeedOptions = {}): Promise<SelfAuditSeedResult> {
    const limit = normalizeLimit(options.limit ?? this.runtimeConfig.selfAuditMaxTickets);
    const existingTickets = await this.repository.listTickets('all');

    if (options.onlyWhenQueueEmpty && existingTickets.some((ticket) => activeStatuses.has(ticket.status))) {
      return {
        summary: 'Skipped self-audit because active tickets already exist.',
        findings: [],
        created: [],
        skippedDuplicates: [],
        skippedBecauseQueueActive: true,
        rawContent: '',
      };
    }

    const snapshot = await this.snapshotProvider();
    const response = await this.backendClient.requestStructuredPlan(
      this.buildPrompt(snapshot, existingTickets, limit),
      this.getSystemPrompt(limit)
    );
    if (!response.success) {
      throw new Error(response.content);
    }

    const heuristicFindings = await this.deriveHeuristicFindings();
    let parsedSummary = 'Self-audit ticket seed';
    let parsedFindings: SelfAuditFinding[] = [];
    try {
      const parsed = parseAuditResponse(response.content, limit);
      parsedSummary = parsed.summary;
      parsedFindings = parsed.findings;
    } catch (error) {
      logger.warn('Self-audit model response was not actionable, falling back to heuristic findings', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const findings = [...parsedFindings];
    for (const heuristicFinding of heuristicFindings) {
      if (findings.length >= limit) {
        break;
      }

      if (
        findings.some(
          (candidate) => normalizeTicketIdentity(candidate.title) === normalizeTicketIdentity(heuristicFinding.title)
        )
      ) {
        continue;
      }

      findings.push(heuristicFinding);
    }

    if (findings.length === 0) {
      throw new Error('Self-audit did not yield any actionable findings.');
    }

    const knownDescriptions = new Set(existingTickets.map((ticket) => normalizeTicketIdentity(ticket.description)));
    const created: Array<{ id: string; description: string }> = [];
    const skippedDuplicates: string[] = [];

    for (const finding of findings) {
      const description = formatTicketDescription(finding);
      const normalized = normalizeTicketIdentity(description);
      if (knownDescriptions.has(normalized)) {
        skippedDuplicates.push(description);
        continue;
      }

      knownDescriptions.add(normalized);
      if (options.dryRun) {
        created.push({ id: 'dry-run', description });
        continue;
      }

      const ticket = await this.repository.createTicket(description);
      created.push({ id: ticket.id, description: ticket.description });
    }

    logger.info('Self-audit seed complete', {
      findings: findings.length,
      created: created.length,
      duplicates: skippedDuplicates.length,
    });

    return {
      summary: parsedSummary,
      findings,
      created,
      skippedDuplicates,
      skippedBecauseQueueActive: false,
      rawContent: response.content,
    };
  }

  private getSystemPrompt(limit: number): string {
    return [
      'You are a repository auditor generating work items only.',
      'Return JSON only.',
      `Return at most ${limit} tickets.`,
      'Do not propose commands to execute.',
      'Prefer concrete, scoped engineering improvements over vague cleanup.',
      'Each ticket must be directly actionable by a software engineer.',
      'Use this JSON shape:',
      '{',
      '  "summary": "short summary",',
      '  "tickets": [',
      '    {',
      '      "title": "actionable task title",',
      '      "priority": "high|medium|low",',
      '      "area": "startup|reliability|safety|testing|tooling|docs|ui|general",',
      '      "rationale": "why this matters",',
      '      "evidence": ["optional repo observations"],',
      '      "acceptance": ["optional acceptance criteria"]',
      '    }',
      '  ]',
      '}',
    ].join('\n');
  }

  private buildPrompt(snapshot: string, existingTickets: TaskTicket[], limit: number): string {
    const existingSummaries = existingTickets
      .slice(-30)
      .map((ticket) => `- [${ticket.status}] ${ticket.description}`)
      .join('\n');

    return [
      `Target project: ${this.runtimeConfig.targetProject}`,
      `Need at most ${limit} new self-audit tickets.`,
      '',
      'Repository snapshot:',
      snapshot,
      '',
      'Existing ticket history (avoid duplicates or near-duplicates of these):',
      existingSummaries || '- none',
      '',
      'Generate prioritized, concrete follow-up tickets for startup, reliability, safety, testing, tooling, docs, or UI gaps you can infer from the repository snapshot.',
      'Do not suggest one meta-ticket that says to audit the repo. Break work into direct tickets.',
    ].join('\n');
  }

  private async buildRepositorySnapshot(): Promise<string> {
    const sections: string[] = [];
    const packageJson = await readSnippet(path.join(this.runtimeConfig.targetProject, 'package.json'));
    if (packageJson) {
      sections.push(`package.json:\n${packageJson}`);
    }

    const readme = await readSnippet(path.join(this.runtimeConfig.targetProject, 'README.md'));
    if (readme) {
      sections.push(`README.md:\n${readme}`);
    }

    const startupScript = await readSnippet(path.join(this.runtimeConfig.targetProject, 'start_all.ps1'));
    if (startupScript) {
      sections.push(`start_all.ps1:\n${startupScript}`);
    }

    const files: string[] = [];
    await walkDirectory(this.runtimeConfig.targetProject, this.runtimeConfig.targetProject, files, 0);
    sections.push(`Workspace files:\n${files.join('\n')}`);

    return sections.join('\n\n').slice(0, 48 * 1024);
  }

  private async deriveHeuristicFindings(): Promise<SelfAuditFinding[]> {
    const findings: SelfAuditFinding[] = [];
    const targetRoot = this.runtimeConfig.targetProject;
    const uiServerPath = path.join(targetRoot, 'src', 'ui-server.ts');
    const uiServerSource = await readSnippet(uiServerPath, 24 * 1024);
    if (uiServerSource && !uiServerSource.includes("url.pathname === '/health'")) {
      findings.push({
        title: 'Add a /health endpoint to the UI server and update smoke checks to use it',
        priority: 'high',
        area: 'startup',
        rationale: 'The launcher currently probes the UI without a dedicated health route.',
        evidence: ['src/ui-server.ts does not expose a /health route.'],
        acceptance: [
          'GET /health returns a simple JSON payload.',
          'Startup smoke tests probe /health instead of relying on the root HTML page.',
        ],
      });
    }

    const hasStartScript = await pathExists(path.join(targetRoot, 'start_all.ps1'));
    const hasStopScript =
      (await pathExists(path.join(targetRoot, 'stop_all.ps1'))) ||
      (await pathExists(path.join(targetRoot, 'stop_all.bat')));
    if (hasStartScript && !hasStopScript) {
      findings.push({
        title: 'Add a stop_all script that terminates daemon and UI processes from PID files',
        priority: 'medium',
        area: 'tooling',
        rationale: 'The startup path records PIDs but does not provide a paired shutdown helper.',
        evidence: ['start_all.ps1 exists, but stop_all.ps1 and stop_all.bat do not.'],
        acceptance: [
          'The stop script reads PID files under run/.',
          'Processes are terminated gracefully when the PID is still active.',
        ],
      });
    }

    return findings;
  }
}