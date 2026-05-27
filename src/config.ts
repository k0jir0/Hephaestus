/**
 * Hephaestus Configuration
 * Loads and validates environment variables
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import type { AIBackend, SafetyConfig } from './types.js';

export interface ConfigValidationIssue {
  code: string;
  message: string;
}

export const supportedAIBackends = ['copilot', 'openai', 'claude', 'ollama'] as const;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.join(__dirname, '..', '.env') });

export interface Config {
  // AI Backend
  aiBackend: AIBackend;
  aiModel: string;
  
  // Safety
  safety: SafetyConfig;
  
  // Project
  targetProject: string;
  
  // Timing
  checkInterval: number;

  // Self-audit
  selfAuditOnStartup?: boolean;
  selfAuditMaxTickets?: number;
  toolRuntimeDryRun?: boolean;
  
  // Paths
  baseDir: string;
  tasksFile: string;
  ticketStoreFile: string;
  allowMarkdownTaskFallback: boolean;
  taskBoardProjectionEnabled: boolean;
  agentMemoryFile: string;
  progressLog: string;
  
  // API Keys (optional based on backend)
  githubToken?: string;
  openaiApiKey?: string;
  anthropicApiKey?: string;
  ollamaBaseUrl?: string;
}

function isSupportedAIBackend(value: string): value is AIBackend {
  return supportedAIBackends.includes(value as AIBackend);
}

function getEnv(key: string, defaultValue?: string): string {
  return process.env[key] || defaultValue || '';
}

function getEnvNumber(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (value === undefined) return defaultValue;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? defaultValue : parsed;
}

function getEnvBoolean(key: string, defaultValue: boolean): boolean {
  const value = process.env[key];
  if (value === undefined) return defaultValue;

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on', 'enabled'].includes(normalized)) {
    return true;
  }

  if (['0', 'false', 'no', 'off', 'disabled'].includes(normalized)) {
    return false;
  }

  return defaultValue;
}

function resolveFromBase(baseDir: string, candidate: string): string {
  if (path.isAbsolute(candidate)) {
    return candidate;
  }

  return path.resolve(baseDir, candidate);
}

export function loadConfig(): Config {
  const baseDir = path.resolve(__dirname, '..');
  const targetProject = resolveFromBase(baseDir, getEnv('TARGET_PROJECT', '.'));
  
  return {
    // AI Backend
    aiBackend: (getEnv('AI_BACKEND', 'copilot') as AIBackend),
    aiModel: getEnv('AI_MODEL', ''),
    
    // Safety
    safety: {
      dailyTokenBudget: getEnvNumber('DAILY_TOKEN_BUDGET', 10.0),
      maxIterations: getEnvNumber('MAX_ITERATIONS', 50),
      errorThreshold: getEnvNumber('ERROR_THRESHOLD', 5),
      autoCommitInterval: getEnvNumber('AUTO_COMMIT_INTERVAL', 30),
    },
    
    // Project
    targetProject,
    
    // Timing
    checkInterval: getEnvNumber('CHECK_INTERVAL', 60) * 1000, // Convert to ms

    // Self-audit
    selfAuditOnStartup: getEnvBoolean('SELF_AUDIT_ON_STARTUP', false),
    selfAuditMaxTickets: getEnvNumber('SELF_AUDIT_MAX_TICKETS', 5),
    toolRuntimeDryRun: getEnvBoolean('TOOL_RUNTIME_DRY_RUN', false),
    
    // Paths
    baseDir,
    tasksFile: path.join(baseDir, 'TASKS.md'),
    ticketStoreFile: resolveFromBase(
      baseDir,
      getEnv('TICKETS_DB_FILE', '.hephaestus-tickets.db')
    ),
    allowMarkdownTaskFallback: getEnvBoolean('ALLOW_MARKDOWN_TASK_FALLBACK', false),
    taskBoardProjectionEnabled: getEnvBoolean('TASK_BOARD_PROJECTION_ENABLED', true),
    agentMemoryFile: path.join(baseDir, 'AGENT.md'),
    progressLog: path.join(baseDir, 'PROGRESS.log'),
    
    // API Keys
    githubToken: getEnv('GITHUB_TOKEN'),
    openaiApiKey: getEnv('OPENAI_API_KEY'),
    anthropicApiKey: getEnv('ANTHROPIC_API_KEY'),
    ollamaBaseUrl: getEnv('OLLAMA_BASE_URL', 'http://localhost:11434'),
  };
}

export function validateConfig(candidate: Config): ConfigValidationIssue[] {
  const issues: ConfigValidationIssue[] = [];

  if (!isSupportedAIBackend(String(candidate.aiBackend))) {
    issues.push({
      code: 'invalid-ai-backend',
      message: `AI_BACKEND must be one of: ${supportedAIBackends.join(', ')}`,
    });
  }

  if (!candidate.targetProject.trim()) {
    issues.push({
      code: 'missing-target-project',
      message: 'TARGET_PROJECT must resolve to a non-empty path.',
    });
  }

  if (!candidate.ticketStoreFile.trim()) {
    issues.push({
      code: 'missing-ticket-store-file',
      message: 'TICKETS_DB_FILE must resolve to a non-empty path.',
    });
  }

  if (typeof candidate.allowMarkdownTaskFallback !== 'boolean') {
    issues.push({
      code: 'invalid-markdown-fallback',
      message: 'ALLOW_MARKDOWN_TASK_FALLBACK must be a boolean value.',
    });
  }

  if (typeof candidate.taskBoardProjectionEnabled !== 'boolean') {
    issues.push({
      code: 'invalid-task-board-projection',
      message: 'TASK_BOARD_PROJECTION_ENABLED must be a boolean value.',
    });
  }

  if (!Number.isFinite(candidate.checkInterval) || candidate.checkInterval <= 0) {
    issues.push({
      code: 'invalid-check-interval',
      message: 'CHECK_INTERVAL must be a positive number of milliseconds.',
    });
  }

  if (
    candidate.selfAuditOnStartup !== undefined &&
    typeof candidate.selfAuditOnStartup !== 'boolean'
  ) {
    issues.push({
      code: 'invalid-self-audit-on-startup',
      message: 'SELF_AUDIT_ON_STARTUP must be a boolean value.',
    });
  }

  if (
    candidate.selfAuditMaxTickets !== undefined &&
    (!Number.isInteger(candidate.selfAuditMaxTickets) || candidate.selfAuditMaxTickets <= 0)
  ) {
    issues.push({
      code: 'invalid-self-audit-max-tickets',
      message: 'SELF_AUDIT_MAX_TICKETS must be a positive integer.',
    });
  }

  if (
    candidate.toolRuntimeDryRun !== undefined &&
    typeof candidate.toolRuntimeDryRun !== 'boolean'
  ) {
    issues.push({
      code: 'invalid-tool-runtime-dry-run',
      message: 'TOOL_RUNTIME_DRY_RUN must be a boolean value.',
    });
  }

  if (!Number.isFinite(candidate.safety.dailyTokenBudget) || candidate.safety.dailyTokenBudget < 0) {
    issues.push({
      code: 'invalid-daily-budget',
      message: 'DAILY_TOKEN_BUDGET must be a finite number greater than or equal to 0.',
    });
  }

  if (
    !Number.isInteger(candidate.safety.maxIterations) ||
    candidate.safety.maxIterations <= 0
  ) {
    issues.push({
      code: 'invalid-max-iterations',
      message: 'MAX_ITERATIONS must be a positive integer.',
    });
  }

  if (
    !Number.isInteger(candidate.safety.errorThreshold) ||
    candidate.safety.errorThreshold <= 0
  ) {
    issues.push({
      code: 'invalid-error-threshold',
      message: 'ERROR_THRESHOLD must be a positive integer.',
    });
  }

  if (
    !Number.isFinite(candidate.safety.autoCommitInterval) ||
    candidate.safety.autoCommitInterval < 0
  ) {
    issues.push({
      code: 'invalid-auto-commit-interval',
      message: 'AUTO_COMMIT_INTERVAL must be a finite number greater than or equal to 0.',
    });
  }

  return issues;
}

export const config = loadConfig();
