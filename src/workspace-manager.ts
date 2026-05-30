import path from 'node:path';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import type { Task } from './types.js';
import type { AttemptWorkspaceMode } from './config.js';

export interface AttemptWorkspaceBinding {
  workspaceId: string;
  workspaceRoot: string;
  isolationMode: 'shared-root' | 'isolated-workspace';
}

export interface AttemptWorkspaceManager {
  bindWorkspace(task: Task, correlationId: string): Promise<AttemptWorkspaceBinding>;
  releaseWorkspace(
    binding: AttemptWorkspaceBinding,
    outcome: 'completed' | 'failed' | 'awaiting-approval' | 'rejected'
  ): Promise<void>;
}

interface WorkspaceManagerOptions {
  targetProject: string;
  mode: AttemptWorkspaceMode;
  workspaceRoot?: string;
}

export class SharedRootWorkspaceManager implements AttemptWorkspaceManager {
  private readonly workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = path.resolve(workspaceRoot);
  }

  async bindWorkspace(task: Task, correlationId: string): Promise<AttemptWorkspaceBinding> {
    return {
      workspaceId: `shared:${task.id}:${correlationId}`,
      workspaceRoot: this.workspaceRoot,
      isolationMode: 'shared-root',
    };
  }

  async releaseWorkspace(): Promise<void> {
    // Shared-root mode has no per-attempt workspace lifecycle to manage.
  }
}

export class IsolatedWorkspaceManager implements AttemptWorkspaceManager {
  private readonly targetProject: string;
  private readonly workspaceRoot: string;
  private readonly fallbackManager: SharedRootWorkspaceManager;

  constructor(targetProject: string, workspaceRoot: string) {
    this.targetProject = path.resolve(targetProject);
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.fallbackManager = new SharedRootWorkspaceManager(this.targetProject);
  }

  async bindWorkspace(task: Task, correlationId: string): Promise<AttemptWorkspaceBinding> {
    const workspaceId = sanitizeWorkspaceId(task.id, correlationId);
    const workspacePath = path.join(this.workspaceRoot, workspaceId);

    const isGitRepository = await this.hasGitMetadata();
    if (!isGitRepository) {
      return this.fallbackManager.bindWorkspace(task, correlationId);
    }

    await fs.mkdir(this.workspaceRoot, { recursive: true });
    await fs.rm(workspacePath, { recursive: true, force: true });

    try {
      await runCommand('git', ['worktree', 'add', '--detach', workspacePath, 'HEAD'], this.targetProject);
      return {
        workspaceId,
        workspaceRoot: workspacePath,
        isolationMode: 'isolated-workspace',
      };
    } catch {
      return this.fallbackManager.bindWorkspace(task, correlationId);
    }
  }

  async releaseWorkspace(
    binding: AttemptWorkspaceBinding,
    outcome: 'completed' | 'failed' | 'awaiting-approval' | 'rejected'
  ): Promise<void> {
    if (binding.isolationMode !== 'isolated-workspace') {
      return;
    }

    // Keep workspace for manual operator review while approval is pending.
    if (outcome === 'awaiting-approval') {
      return;
    }

    try {
      await runCommand('git', ['worktree', 'remove', '--force', binding.workspaceRoot], this.targetProject);
      return;
    } catch {
      // Fallback cleanup if git worktree metadata is already detached or unavailable.
    }

    await fs.rm(binding.workspaceRoot, { recursive: true, force: true });
  }

  private async hasGitMetadata(): Promise<boolean> {
    try {
      const stats = await fs.stat(path.join(this.targetProject, '.git'));
      return stats.isDirectory() || stats.isFile();
    } catch {
      return false;
    }
  }
}

export function createAttemptWorkspaceManager(options: WorkspaceManagerOptions): AttemptWorkspaceManager {
  if (options.mode === 'isolated-workspace') {
    return new IsolatedWorkspaceManager(
      options.targetProject,
      options.workspaceRoot ?? path.join(options.targetProject, '.hephaestus', 'workspaces')
    );
  }

  return new SharedRootWorkspaceManager(options.targetProject);
}

function sanitizeWorkspaceId(ticketId: string, correlationId: string): string {
  const safeTicketId = ticketId.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 48);
  const safeCorrelationId = correlationId.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 48);
  return `attempt_${safeTicketId}_${safeCorrelationId}`;
}

function runCommand(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: 'ignore',
      windowsHide: true,
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} exited with code ${code ?? -1}`));
    });
  });
}
