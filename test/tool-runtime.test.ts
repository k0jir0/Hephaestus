import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { EngineeringToolRuntime } from '../src/tool-runtime.js';

const tempDirs: string[] = [];

async function createWorkspace(): Promise<string> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'Hephaestus-tools-'));
  tempDirs.push(rootDir);
  await fs.mkdir(path.join(rootDir, 'src'), { recursive: true });
  await fs.writeFile(path.join(rootDir, 'README.md'), 'old heading\n', 'utf-8');
  await fs.writeFile(path.join(rootDir, 'src', 'demo.ts'), 'export const answer = 42;\n', 'utf-8');
  await fs.writeFile(
    path.join(rootDir, 'package.json'),
    JSON.stringify(
      {
        name: 'hephaestus-tool-runtime-fixture',
        private: true,
        scripts: {
          build: 'node -e "console.log(\'build ok\')"',
        },
      },
      null,
      2
    ),
    'utf-8'
  );
  await fs.writeFile(path.join(rootDir, '.env'), 'SECRET=value\n', 'utf-8');
  return rootDir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const tempDir = tempDirs.pop();
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }
});

describe('EngineeringToolRuntime', () => {
  it('reads bounded workspace files and denies protected or escaping paths', async () => {
    const workspaceRoot = await createWorkspace();
    const runtime = new EngineeringToolRuntime({ workspaceRoot });

    const readResult = await runtime.execute({
      tool: 'file.read',
      path: 'src/demo.ts',
    });
    assert.equal(readResult.status, 'success');
    assert.match(readResult.output ?? '', /answer = 42/);

    const protectedResult = await runtime.execute({
      tool: 'file.read',
      path: '.env',
    });
    assert.equal(protectedResult.status, 'denied');
    assert.equal(protectedResult.reasonCode, 'protected-path');

    const escapeResult = await runtime.execute({
      tool: 'file.read',
      path: '../outside.txt',
    });
    assert.equal(escapeResult.status, 'denied');
    assert.equal(escapeResult.reasonCode, 'path-escapes-workspace');
  });

  it('searches repository text without traversing ignored directories', async () => {
    const workspaceRoot = await createWorkspace();
    await fs.mkdir(path.join(workspaceRoot, 'node_modules', 'package'), { recursive: true });
    await fs.writeFile(
      path.join(workspaceRoot, 'node_modules', 'package', 'index.js'),
      'answer = 42\n',
      'utf-8'
    );

    const runtime = new EngineeringToolRuntime({ workspaceRoot });
    const result = await runtime.execute({
      tool: 'repo.search',
      query: 'answer = 42',
    });

    assert.equal(result.status, 'success');
    assert.match(result.output ?? '', /src\/demo.ts:1/);
    assert.doesNotMatch(result.output ?? '', /node_modules/);
  });

  it('validates patches in dry-run mode before applying them', async () => {
    const workspaceRoot = await createWorkspace();
    const runtime = new EngineeringToolRuntime({ workspaceRoot });
    const patch = [
      'diff --git a/README.md b/README.md',
      '--- a/README.md',
      '+++ b/README.md',
      '@@ -1 +1 @@',
      '-old heading',
      '+new heading',
      '',
    ].join('\n');

    const dryRunResult = await runtime.execute({
      tool: 'patch.apply',
      patch,
      dryRun: true,
    });
    assert.equal(dryRunResult.status, 'dry_run');
    assert.equal(dryRunResult.reasonCode, 'dry-run-only');
    assert.deepEqual(dryRunResult.mutatedPaths, ['README.md']);
    assert.equal(await fs.readFile(path.join(workspaceRoot, 'README.md'), 'utf-8'), 'old heading\n');

    const applyResult = await runtime.execute({
      tool: 'patch.apply',
      patch,
    });
    assert.equal(applyResult.status, 'success');
    assert.equal(
      (await fs.readFile(path.join(workspaceRoot, 'README.md'), 'utf-8')).replace(/\r\n/g, '\n'),
      'new heading\n'
    );
  });

  it('returns a signed policy snapshot and requires approval for risky patch apply requests', async () => {
    const workspaceRoot = await createWorkspace();
    const runtime = new EngineeringToolRuntime({
      workspaceRoot,
      maxSafePatchPaths: 1,
      maxSafePatchChangedLines: 2,
    });
    const patch = [
      'diff --git a/README.md b/README.md',
      '--- a/README.md',
      '+++ b/README.md',
      '@@ -1 +1 @@',
      '-old heading',
      '+new heading',
      'diff --git a/src/demo.ts b/src/demo.ts',
      '--- a/src/demo.ts',
      '+++ b/src/demo.ts',
      '@@ -1 +1 @@',
      '-export const answer = 42;',
      '+export const answer = 43;',
      '',
    ].join('\n');

    const snapshot = runtime.getPolicySnapshot();
    const dryRunResult = await runtime.execute({
      tool: 'patch.apply',
      patch,
      dryRun: true,
    });
    const applyResult = await runtime.execute({
      tool: 'patch.apply',
      patch,
    });

    assert.equal(snapshot.version, 'hephaestus-tool-policy/v1');
    assert.match(snapshot.signature, /^[a-f0-9]{16}$/);
    assert.equal(dryRunResult.status, 'dry_run');
    assert.equal(applyResult.status, 'denied');
    assert.equal(applyResult.reasonCode, 'approval-required');
    assert.match(applyResult.summary, /requires approval/);
    assert.deepEqual(applyResult.mutatedPaths, ['README.md', 'src/demo.ts']);
  });

  it('denies non-allowlisted commands and runs explicit verification commands', async () => {
    const workspaceRoot = await createWorkspace();
    const runtime = new EngineeringToolRuntime({
      workspaceRoot,
      commandAllowlist: [
        {
          command: process.execPath,
          args: ['-e', 'console.log("ok")'],
        },
      ],
    });

    const deniedResult = await runtime.execute({
      tool: 'command.run',
      command: process.execPath,
      args: ['-e', 'console.log("not allowed")'],
    });
    assert.equal(deniedResult.status, 'denied');
    assert.equal(deniedResult.reasonCode, 'command-not-allowlisted');

    const allowedResult = await runtime.execute({
      tool: 'command.run',
      command: process.execPath,
      args: ['-e', 'console.log("ok")'],
    });
    assert.equal(allowedResult.status, 'success');
    assert.match(allowedResult.output ?? '', /ok/);
  });

  it('allows safe npm build verification commands on Windows without requiring npm.cmd in the plan', async () => {
    if (process.platform !== 'win32') {
      return;
    }

    const workspaceRoot = await createWorkspace();
    const runtime = new EngineeringToolRuntime({ workspaceRoot });

    const result = await runtime.execute({
      tool: 'command.run',
      command: 'npm',
      args: ['run', 'build'],
    });

    assert.equal(result.status, 'success');
    assert.match(result.output ?? '', /build ok/);
  });

  it('allowlists safe model diagnostics commands by default policy', async () => {
    const workspaceRoot = await createWorkspace();
    const runtime = new EngineeringToolRuntime({ workspaceRoot });

    const result = await runtime.execute({
      tool: 'command.run',
      command: 'npm',
      args: ['run', 'models:benchmark'],
    });

    assert.notEqual(result.reasonCode, 'command-not-allowlisted');
  });

  it('fails closed for delivery tools until approval-backed adapters exist', async () => {
    const workspaceRoot = await createWorkspace();
    const runtime = new EngineeringToolRuntime({ workspaceRoot });

    const result = await runtime.execute({ tool: 'github.pr' });

    assert.equal(result.status, 'denied');
    assert.equal(result.reasonCode, 'delivery-adapter-required');
    assert.match(result.summary, /requires an approval-backed delivery adapter/);
  });
});
