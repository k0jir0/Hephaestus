import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { afterEach, describe, it } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { TicketStoreRepository } from '../src/task-store.js';

const require = createRequire(import.meta.url);
const tsxCliPath = require.resolve('tsx/cli');
const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const tempDirs: string[] = [];

async function createFixture(): Promise<{
  rootDir: string;
  ticketStoreFile: string;
  ticketId: string;
}> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'Hephaestus-tickets-cli-'));
  tempDirs.push(rootDir);
  const ticketStoreFile = path.join(rootDir, '.hephaestus-tickets.db');

  const repository = new TicketStoreRepository({
    tasksFile: path.join(rootDir, 'TASKS.md'),
    storeFile: ticketStoreFile,
    importLegacyTaskBoardIfStoreEmpty: false,
    projectionEnabled: false,
  });

  const ticket = await repository.createTicket('CLI inspection coverage ticket');
  await repository.markTaskInProgress(ticket);
  await repository.appendTaskAttemptArtifacts(ticket.id, [
    '[cli_evidence_1] policy.snapshot [policy_cli_1] {"version":"hephaestus-tool-policy/v1","dryRunByDefault":false}',
    '[cli_evidence_1] patch.delta src/runtime.ts: dry-run=allowed; apply=denied; mutatedPaths=src/runtime.ts',
  ]);
  await repository.markTaskCompleted({
    ...ticket,
    status: 'completed',
    result: 'Plan ready',
  });

  const [attempt] = await repository.listAttempts(ticket.id);
  assert.ok(attempt);

  const workerVersion = await repository.createWorkerVersion({
    attemptId: attempt.id,
    workspaceId: 'workspace_cli',
    workspaceRoot: rootDir,
    patchBundlePath: path.join(rootDir, 'bundle.patch'),
    verificationSummary: 'build and tests passed',
  });
  await repository.updateWorkerVersionStatus(workerVersion.id, 'promotable');
  await repository.updateWorkerVersionStatus(workerVersion.id, 'active');

  const promotion = await repository.createPromotionRecord({
    workerVersionId: workerVersion.id,
    approvedBy: 'approver@example.com',
    approvalId: 'approval_cli',
  });
  await repository.updatePromotionStatus(promotion.id, 'verified');
  await repository.updatePromotionStatus(promotion.id, 'started');
  await repository.updatePromotionStatus(promotion.id, 'health_check_passed');
  await repository.updatePromotionStatus(promotion.id, 'completed');

  await repository.stop();

  return { rootDir, ticketStoreFile, ticketId: ticket.id };
}

async function runTickets(args: string[], env: NodeJS.ProcessEnv): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
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
      if (code === 0) {
        resolve(stdout);
        return;
      }

      reject(new Error(`tickets CLI exited with code ${code}: ${stderr || stdout}`));
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

describe('tickets CLI', () => {
  it('prints timeline entries for a ticket', async () => {
    const fixture = await createFixture();
    const output = await runTickets(
      ['timeline', fixture.ticketId],
      {
        TARGET_PROJECT: repoRoot,
        TICKETS_DB_FILE: fixture.ticketStoreFile,
        TASK_BOARD_PROJECTION_ENABLED: 'false',
        ALLOW_MARKDOWN_TASK_FALLBACK: 'false',
      }
    );

    assert.match(output, /Timeline entries:/);
    assert.match(output, /event\.completed/);
    assert.match(output, /promotion\.updated/);
  });

  it('prints terminal evidence for a ticket', async () => {
    const fixture = await createFixture();
    const output = await runTickets(
      ['evidence', fixture.ticketId],
      {
        TARGET_PROJECT: repoRoot,
        TICKETS_DB_FILE: fixture.ticketStoreFile,
        TASK_BOARD_PROJECTION_ENABLED: 'false',
        ALLOW_MARKDOWN_TASK_FALLBACK: 'false',
      }
    );

    assert.match(output, /Ticket:/);
    assert.match(output, /Policy snapshots: 1/);
    assert.match(output, /policy_cli_1/);
    assert.match(output, /Patch deltas: 1/);
    assert.match(output, /src\/runtime\.ts/);
  });

  it('prints gate and recovery inspection rows for a ticket', async () => {
    const fixture = await createFixture();
    const output = await runTickets(
      ['gates', fixture.ticketId],
      {
        TARGET_PROJECT: repoRoot,
        TICKETS_DB_FILE: fixture.ticketStoreFile,
        TASK_BOARD_PROJECTION_ENABLED: 'false',
        ALLOW_MARKDOWN_TASK_FALLBACK: 'false',
      }
    );

    assert.match(output, /Gate Status:/);
    assert.match(output, /no mutable targets/);
    assert.match(output, /Recovery Family:/);
  });

  it('prints worker version inspection rows for a ticket', async () => {
    const fixture = await createFixture();
    const output = await runTickets(
      ['worker-versions', fixture.ticketId],
      {
        TARGET_PROJECT: repoRoot,
        TICKETS_DB_FILE: fixture.ticketStoreFile,
        TASK_BOARD_PROJECTION_ENABLED: 'false',
        ALLOW_MARKDOWN_TASK_FALLBACK: 'false',
      }
    );

    assert.match(output, /worker_/);
    assert.match(output, /attempt=/);
    assert.match(output, /workspace=workspace_cli/);
    assert.match(output, /active/);
    assert.match(output, /activated=/);
  });

  it('prints promotion inspection rows for a ticket', async () => {
    const fixture = await createFixture();
    const output = await runTickets(
      ['promotions', fixture.ticketId],
      {
        TARGET_PROJECT: repoRoot,
        TICKETS_DB_FILE: fixture.ticketStoreFile,
        TASK_BOARD_PROJECTION_ENABLED: 'false',
        ALLOW_MARKDOWN_TASK_FALLBACK: 'false',
      }
    );

    assert.match(output, /promotion_/);
    assert.match(output, /worker=/);
    assert.match(output, /attempt=1/);
    assert.match(output, /workspace=workspace_cli/);
    assert.match(output, /completed/);
    assert.match(output, /requested=/);
    assert.match(output, /updated=/);
  });
});