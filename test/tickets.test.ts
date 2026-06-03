import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { afterEach, describe, it } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const tsxCliPath = require.resolve('tsx/cli');
const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const tempDirs: string[] = [];

async function createIsolatedStore(): Promise<{
  rootDir: string;
  ticketStoreFile: string;
}> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'Hephaestus-tickets-create-'));
  tempDirs.push(rootDir);

  return {
    rootDir,
    ticketStoreFile: path.join(rootDir, '.hephaestus-tickets.db'),
  };
}

async function runTickets(args: string[], env: NodeJS.ProcessEnv): Promise<{
  stdout: string;
  stderr: string;
  code: number;
}> {
  return await new Promise((resolve, reject) => {
    const child = spawn('node', [tsxCliPath, path.join(repoRoot, 'src', 'tickets.ts'), ...args], {
      cwd: repoRoot,
      env: {
        ...process.env,
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({
        stdout,
        stderr,
        code: code ?? 1,
      });
    });
  });
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const directory = tempDirs.pop();
    if (directory) {
      await fs.rm(directory, { recursive: true, force: true });
    }
  }
});

describe('tickets create command', () => {
  it('rejects broad descriptions with template guidance', async () => {
    const fixture = await createIsolatedStore();
    const result = await runTickets(
      ['create', 'deploy', 'the', 'whole', 'platform', 'and', 'rewrite', 'everything'],
      {
        TARGET_PROJECT: fixture.rootDir,
        TICKETS_DB_FILE: fixture.ticketStoreFile,
        TASK_BOARD_PROJECTION_ENABLED: 'false',
        ALLOW_MARKDOWN_TASK_FALLBACK: 'false',
      }
    );

    const combinedOutput = `${result.stdout}\n${result.stderr}`;

    assert.equal(result.code, 1);
    assert.match(combinedOutput, /Ticket template quality score=3\/8/);
    assert.match(combinedOutput, /Description appears broad or delivery-oriented/);
    assert.match(combinedOutput, /expected signal/);
  });

  it('accepts bounded descriptions with verification signals', async () => {
    const fixture = await createIsolatedStore();
    const result = await runTickets(
      [
        'create',
        'Implement',
        'bounded',
        'create-command',
        'test',
        'in',
        'test/tickets.test.ts',
        'and',
        'verify',
        'with',
        'npm',
        'test',
        'with',
        'expected',
        'signal:',
        'create',
        'test',
        'exits',
        '0.',
      ],
      {
        TARGET_PROJECT: fixture.rootDir,
        TICKETS_DB_FILE: fixture.ticketStoreFile,
        TASK_BOARD_PROJECTION_ENABLED: 'false',
        ALLOW_MARKDOWN_TASK_FALLBACK: 'false',
      }
    );

    assert.equal(result.code, 0);
    assert.match(result.stdout, /Created ticket_[a-z0-9]+ \[pending\]/i);
    assert.match(result.stdout, /test\/tickets\.test\.ts/);
    assert.match(result.stdout, /expected signal: create test exits 0\./i);
  });
});