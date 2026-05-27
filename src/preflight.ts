import fs from 'fs/promises';
import path from 'path';
import { config as defaultConfig, type Config, validateConfig } from './config.js';
import {
  AdmissionController,
  createSafetyAdmissionGate,
  type AdmissionDecision,
  type HealthChecker,
  type SafetyGate,
} from './admission.js';
import type { Task } from './types.js';

export interface PreflightIssue {
  severity: 'error' | 'warning';
  code: string;
  message: string;
}

export interface PreflightResult {
  ok: boolean;
  issues: PreflightIssue[];
}

async function pathType(targetPath: string): Promise<'missing' | 'file' | 'directory'> {
  try {
    const stats = await fs.stat(targetPath);
    if (stats.isDirectory()) {
      return 'directory';
    }

    return 'file';
  } catch {
    return 'missing';
  }
}

function createError(code: string, message: string): PreflightIssue {
  return {
    severity: 'error',
    code,
    message,
  };
}

function createWarning(code: string, message: string): PreflightIssue {
  return {
    severity: 'warning',
    code,
    message,
  };
}

export async function runStartupPreflight(options: {
  config?: Config;
  healthChecker?: HealthChecker;
} = {}): Promise<PreflightResult> {
  const activeConfig = options.config ?? defaultConfig;
  const issues: PreflightIssue[] = validateConfig(activeConfig).map((issue) =>
    createError(issue.code, issue.message)
  );

  const targetProjectType = await pathType(activeConfig.targetProject);
  if (targetProjectType === 'missing') {
    issues.push(
      createError(
        'missing-target-project',
        `Target project path does not exist: ${activeConfig.targetProject}`
      )
    );
  } else if (targetProjectType !== 'directory') {
    issues.push(
      createError(
        'invalid-target-project',
        `Target project path must be a directory: ${activeConfig.targetProject}`
      )
    );
  }

  const tasksFileType = await pathType(activeConfig.tasksFile);
  if (tasksFileType === 'directory') {
    issues.push(
      createWarning(
        'invalid-task-projection-path',
        `TASKS.md projection path points to a directory and will be skipped: ${activeConfig.tasksFile}`
      )
    );
  }

  const tasksDirectoryType = await pathType(path.dirname(activeConfig.tasksFile));
  if (tasksDirectoryType !== 'directory') {
    issues.push(
      createWarning(
        'missing-task-projection-directory',
        `TASKS.md projection parent directory does not exist: ${path.dirname(activeConfig.tasksFile)}`
      )
    );
  }

  const memoryDirectoryType = await pathType(path.dirname(activeConfig.agentMemoryFile));
  if (memoryDirectoryType !== 'directory') {
    issues.push(
      createError(
        'missing-memory-directory',
        `AGENT.md parent directory does not exist: ${path.dirname(activeConfig.agentMemoryFile)}`
      )
    );
  }

  const progressDirectoryType = await pathType(path.dirname(activeConfig.progressLog));
  if (progressDirectoryType !== 'directory') {
    issues.push(
      createError(
        'missing-progress-directory',
        `PROGRESS.log parent directory does not exist: ${path.dirname(activeConfig.progressLog)}`
      )
    );
  }

  const ticketStoreDirectoryType = await pathType(path.dirname(activeConfig.ticketStoreFile));
  if (ticketStoreDirectoryType !== 'directory') {
    issues.push(
      createError(
        'missing-ticket-store-directory',
        `Ticket store parent directory does not exist: ${path.dirname(activeConfig.ticketStoreFile)}`
      )
    );
  }

  if (options.healthChecker) {
    try {
      const health = await options.healthChecker.checkHealth();
      if (!health.available) {
        issues.push(createWarning('backend-unavailable', health.message));
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      issues.push(
        createWarning('backend-health-check-failed', `Backend health check failed: ${errorMessage}`)
      );
    }
  }

  return {
    ok: !issues.some((issue) => issue.severity === 'error'),
    issues,
  };
}

export async function evaluateTaskAdmission(
  task: Task,
  safety: SafetyGate
): Promise<AdmissionDecision> {
  const controller = new AdmissionController([createSafetyAdmissionGate(safety)]);
  return controller.evaluate(task);
}
