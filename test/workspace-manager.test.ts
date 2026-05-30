import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { spawn } from 'node:child_process';
import {
  SharedRootWorkspaceManager,
  IsolatedWorkspaceManager,
  createAttemptWorkspaceManager,
} from '../src/workspace-manager.js';

async function runGit(args: string[], cwd: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('git', args, {
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

      reject(new Error(`git ${args.join(' ')} exited with code ${code ?? -1}`));
    });
  });
}

async function createGitRepoFixture(): Promise<{ rootDir: string }> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'Hephaestus-worktree-git-'));
  await runGit(['init'], rootDir);
  await runGit(['config', 'user.email', 'hephaestus@example.com'], rootDir);
  await runGit(['config', 'user.name', 'Hephaestus'], rootDir);
  await fs.writeFile(path.join(rootDir, 'README.md'), 'initial\n', 'utf-8');
  await runGit(['add', 'README.md'], rootDir);
  await runGit(['commit', '-m', 'initial commit'], rootDir);
  return { rootDir };
}

describe('SharedRootWorkspaceManager', () => {
  it('binds every task to the configured shared workspace root', async () => {
    const manager = new SharedRootWorkspaceManager('.');
    const binding = await manager.bindWorkspace(
      {
        id: 'ticket_demo',
        description: 'Demo task',
        status: 'pending',
        createdAt: new Date(),
      },
      'admission_demo'
    );

    assert.equal(binding.isolationMode, 'shared-root');
    assert.equal(binding.workspaceRoot, path.resolve('.'));
    assert.match(binding.workspaceId, /^shared:ticket_demo:admission_demo$/);
  });

  it('treats release as a no-op in shared-root mode', async () => {
    const manager = new SharedRootWorkspaceManager('.');
    await manager.releaseWorkspace(
      {
        workspaceId: 'shared:ticket_demo:admission_demo',
        workspaceRoot: path.resolve('.'),
        isolationMode: 'shared-root',
      },
      'completed'
    );
  });
});

describe('createAttemptWorkspaceManager', () => {
  it('returns shared-root binding when mode is shared-root', async () => {
    const manager = createAttemptWorkspaceManager({
      targetProject: '.',
      mode: 'shared-root',
    });

    const binding = await manager.bindWorkspace(
      {
        id: 'ticket_shared',
        description: 'Shared mode',
        status: 'pending',
        createdAt: new Date(),
      },
      'admission_shared'
    );

    assert.equal(binding.isolationMode, 'shared-root');
    assert.equal(binding.workspaceRoot, path.resolve('.'));
  });

  it('falls back to shared-root when isolated mode target is not a git repository', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'Hephaestus-workspace-manager-'));
    const manager = createAttemptWorkspaceManager({
      targetProject: tempRoot,
      mode: 'isolated-workspace',
      workspaceRoot: path.join(tempRoot, '.hephaestus', 'workspaces'),
    });

    try {
      const binding = await manager.bindWorkspace(
        {
          id: 'ticket_isolated_fallback',
          description: 'Isolated fallback mode',
          status: 'pending',
          createdAt: new Date(),
        },
        'admission_fallback'
      );

      assert.equal(binding.isolationMode, 'shared-root');
      assert.equal(binding.workspaceRoot, path.resolve(tempRoot));
      await manager.releaseWorkspace(binding, 'failed');
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('creates and cleans up an isolated worktree when the target is a git repository', async () => {
    const fixture = await createGitRepoFixture();
    const workspaceRoot = path.join(fixture.rootDir, '.hephaestus', 'workspaces');
    const manager = createAttemptWorkspaceManager({
      targetProject: fixture.rootDir,
      mode: 'isolated-workspace',
      workspaceRoot,
    });

    try {
      const binding = await manager.bindWorkspace(
        {
          id: 'ticket_isolated_git',
          description: 'Isolated git workspace',
          status: 'pending',
          createdAt: new Date(),
        },
        'admission_git'
      );

      assert.equal(binding.isolationMode, 'isolated-workspace');
      assert.match(binding.workspaceRoot, /^.*Hephaestus-worktree-git-.*[\\/]\.hephaestus[\\/]workspaces[\\/]attempt_ticket_isolated_git_admission_git$/);
      assert.equal(await fs.stat(binding.workspaceRoot).then((stats) => stats.isDirectory()), true);

      await manager.releaseWorkspace(binding, 'completed');
      await assert.rejects(fs.stat(binding.workspaceRoot));
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true });
    }
  });
});
