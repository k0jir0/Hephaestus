import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { setTimeout as delay } from 'timers/promises';
import { afterEach, describe, it } from 'node:test';
import { TicketStoreRepository } from '../src/task-store.js';
import type { Task } from '../src/types.js';

const tempDirs: string[] = [];

async function createFixtureRepo(tasksContent: string): Promise<{
  rootDir: string;
  tasksFile: string;
  ticketStoreFile: string;
}> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'Hephaestus-task-store-'));
  tempDirs.push(rootDir);

  const tasksFile = path.join(rootDir, 'TASKS.md');
  const ticketStoreFile = path.join(rootDir, '.hephaestus-tickets.db');
  await fs.writeFile(tasksFile, tasksContent, 'utf-8');

  return { rootDir, tasksFile, ticketStoreFile };
}

function withCompletedTask(task: Task): Task {
  return {
    ...task,
    status: 'completed',
    result: 'Plan ready',
  };
}

async function waitFor(
  assertion: () => boolean | Promise<boolean>,
  timeoutMs = 500
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await assertion()) {
      return;
    }

    await delay(10);
  }

  assert.fail('Timed out waiting for condition.');
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const tempDir = tempDirs.pop();
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }
});

describe('TicketStoreRepository', () => {
  it('bootstraps legacy tickets from TASKS.md when the store is empty and projects stable ticket ids back to markdown', async () => {
    const fixture = await createFixtureRepo(`# Hephaestus Task Queue

## Queue

- [ ] Build demo

## In Progress

- (empty)

## Completed

- (empty)

## Blocked

- (empty)

## Cancelled

- (empty)
`);

    const repository = new TicketStoreRepository({
      tasksFile: fixture.tasksFile,
      storeFile: fixture.ticketStoreFile,
    });

    const [task] = await repository.getPendingTasks();
    assert.equal(task?.description, 'Build demo');
    assert.match(task?.id ?? '', /^ticket_[a-z0-9]+$/i);

    await repository.markTaskInProgress(task!);
    await repository.markTaskCompleted(withCompletedTask(task!));

    const attempts = await repository.listAttempts(task!.id);
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0]?.attemptNumber, 1);
    assert.equal(attempts[0]?.status, 'completed');
    assert.equal(attempts[0]?.result, 'Plan ready');

    await repository.stop();

    const projectedBoard = await fs.readFile(fixture.tasksFile, 'utf-8');
    assert.match(projectedBoard, /## Queue[\s\S]*- \(empty\)/);
    assert.match(projectedBoard, /## Completed[\s\S]*- \[x\] Build demo <!-- hephaestus-ticket:ticket_[a-z0-9]+ -->/i);
  });

  it('does not treat TASKS.md as ongoing intake after the initial bootstrap', async () => {
    const originalBoard = `# Hephaestus Task Queue

## Queue

- [ ] Build demo

## In Progress

- (empty)

## Completed

- (empty)

## Blocked

- (empty)

## Cancelled

- (empty)
`;
    const fixture = await createFixtureRepo(originalBoard);

    const repository = new TicketStoreRepository({
      tasksFile: fixture.tasksFile,
      storeFile: fixture.ticketStoreFile,
    });

    const [task] = await repository.getPendingTasks();
    await repository.markTaskInProgress(task!);
    await repository.markTaskCompleted(withCompletedTask(task!));

    await fs.writeFile(fixture.tasksFile, originalBoard, 'utf-8');

    const pendingTasks = await repository.getPendingTasks();
    assert.equal(pendingTasks.length, 0);

    await repository.stop();
  });

  it('creates and retries tickets directly through the object store without requiring TASKS.md input', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'Hephaestus-task-store-'));
    tempDirs.push(rootDir);

    const tasksFile = path.join(rootDir, 'TASKS.md');
    const ticketStoreFile = path.join(rootDir, '.hephaestus-tickets.db');
    const repository = new TicketStoreRepository({
      tasksFile,
      storeFile: ticketStoreFile,
      importLegacyTaskBoardIfStoreEmpty: false,
      projectionEnabled: false,
    });

    const pendingTicket = await repository.createTicket('Build demo');
    const blockedTicket = await repository.createTicket('Retry demo', {
      status: 'blocked',
    });

    assert.equal(pendingTicket.status, 'pending');
    assert.equal(blockedTicket.status, 'blocked');
    await assert.rejects(fs.access(tasksFile), /ENOENT/);

    const retriedTicket = await repository.retryTicket(blockedTicket.id);
    assert.equal(retriedTicket.status, 'pending');

    const cancelledTicket = await repository.cancelTicket(pendingTicket.id, 'No longer needed');
    assert.equal(cancelledTicket.status, 'cancelled');

    const allTickets = await repository.listTickets();
    assert.equal(allTickets.length, 2);
    assert.equal(
      allTickets.filter((ticket) => ticket.status === 'pending').length,
      1
    );
    assert.equal(
      allTickets.filter((ticket) => ticket.status === 'cancelled').length,
      1
    );

    const board = await repository.renderTaskBoardProjection();
    assert.match(board, /Build demo/);
    assert.match(board, /Retry demo/);

    const events = await repository.listEvents(blockedTicket.id);
    assert.ok(events.some((event) => event.type === 'requeued'));

    await repository.stop();
  });

  it('rediscovers a pending ticket after the redispatch interval when admission leaves it queued', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'Hephaestus-task-store-'));
    tempDirs.push(rootDir);

    const repository = new TicketStoreRepository({
      tasksFile: path.join(rootDir, 'TASKS.md'),
      storeFile: path.join(rootDir, '.hephaestus-tickets.db'),
      importLegacyTaskBoardIfStoreEmpty: false,
      projectionEnabled: false,
      pollingIntervalMs: 10,
      redispatchPendingAfterMs: 20,
    });

    const ticket = await repository.createTicket('Wait for policy reset');
    let seen = 0;

    await repository.start(async (task) => {
      seen += 1;

      if (seen >= 2) {
        await repository.markTaskInProgress(task);
        await repository.markTaskBlocked({
          ...task,
          status: 'blocked',
          error: 'Stop after redispatch',
        });
      }
    });

    await waitFor(() => seen >= 2);

    const updatedTicket = await repository.getTicket(ticket.id);
    assert.equal(updatedTicket?.status, 'blocked');

    const attempts = await repository.listAttempts(ticket.id);
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0]?.status, 'blocked');

    await repository.stop();
  });

  it('retries TASKS.md projection after transient write failures instead of suspending projection permanently', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'Hephaestus-task-store-'));
    tempDirs.push(rootDir);

    const tasksFile = path.join(rootDir, 'TASKS.md');
    const ticketStoreFile = path.join(rootDir, '.hephaestus-tickets.db');
    let locked = true;
    let writes = 0;

    const repository = new TicketStoreRepository({
      tasksFile,
      storeFile: ticketStoreFile,
      importLegacyTaskBoardIfStoreEmpty: false,
      projectionEnabled: true,
      projectionRetryDelayMs: 10,
      projectionRetryMaxDelayMs: 20,
      projectionWriter: async (targetPath, content) => {
        writes += 1;
        if (locked) {
          throw new Error('TASKS.md is temporarily locked');
        }

        await fs.writeFile(targetPath, content, 'utf-8');
      },
    });

    await repository.createTicket('Recover projection after lock');

    await waitFor(() => repository.getProjectionHealthStatus().retryScheduled, 1_000);

    const unhealthyStatus = repository.getProjectionHealthStatus();
    assert.equal(unhealthyStatus.healthy, false);
    assert.equal(unhealthyStatus.retryScheduled, true);
    assert.match(unhealthyStatus.lastError ?? '', /temporarily locked/);

    locked = false;

    await waitFor(async () => {
      try {
        const board = await fs.readFile(tasksFile, 'utf-8');
        return board.includes('Recover projection after lock');
      } catch {
        return false;
      }
    }, 1_000);

    const healthyStatus = repository.getProjectionHealthStatus();
    assert.equal(healthyStatus.healthy, true);
    assert.equal(healthyStatus.retryScheduled, false);
    assert.ok(writes >= 2);

    await repository.stop();
  });

  it('stores durable side effects idempotently and records their correlation lifecycle', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'Hephaestus-task-store-'));
    tempDirs.push(rootDir);

    const repository = new TicketStoreRepository({
      tasksFile: path.join(rootDir, 'TASKS.md'),
      storeFile: path.join(rootDir, '.hephaestus-tickets.db'),
      importLegacyTaskBoardIfStoreEmpty: false,
      projectionEnabled: false,
    });

    const ticket = await repository.createTicket('Capture durable side effects');
    const sideEffects = await repository.enqueueTaskSideEffects(ticket.id, [
      {
        type: 'memory.record-task-completion',
        payload: { result: 'Plan ready' },
        idempotencyKey: 'effect-key-1',
        correlationId: 'corr_demo',
      },
      {
        type: 'memory.add-session-summary',
        payload: { summary: 'Planned ticket' },
        idempotencyKey: 'effect-key-2',
        correlationId: 'corr_demo',
      },
    ]);
    const duplicate = await repository.enqueueTaskSideEffects(ticket.id, [
      {
        type: 'memory.record-task-completion',
        payload: { result: 'Plan ready' },
        idempotencyKey: 'effect-key-1',
        correlationId: 'corr_demo',
      },
    ]);

    await repository.markTaskSideEffectProcessed(sideEffects[0]!.id);
    await repository.markTaskSideEffectFailed(sideEffects[1]!.id, 'disk full');

    const persisted = await repository.listTaskSideEffects(ticket.id);
    const events = await repository.listEvents(ticket.id);

    assert.equal(sideEffects.length, 2);
    assert.equal(duplicate.length, 1);
    assert.equal(persisted.length, 2);
    assert.equal(persisted[0]!.status, 'completed');
    assert.equal(persisted[1]!.status, 'failed');
    assert.equal(persisted[1]!.lastError, 'disk full');
    assert.ok(events.some((event) => event.type === 'side-effect-enqueued' && event.correlationId === 'corr_demo'));
    assert.ok(events.some((event) => event.type === 'side-effect-completed' && event.correlationId === 'corr_demo'));
    assert.ok(events.some((event) => event.type === 'side-effect-failed' && event.correlationId === 'corr_demo'));

    await repository.stop();
  });

  it('persists awaiting approval as a durable attempt and ticket state', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'Hephaestus-task-store-'));
    tempDirs.push(rootDir);

    const repository = new TicketStoreRepository({
      tasksFile: path.join(rootDir, 'TASKS.md'),
      storeFile: path.join(rootDir, '.hephaestus-tickets.db'),
      importLegacyTaskBoardIfStoreEmpty: false,
      projectionEnabled: false,
    });

    const ticket = await repository.createTicket('Await approval for a patch');
    await repository.markTaskInProgress(ticket);
    await repository.markTaskAwaitingApproval({
      ...ticket,
      status: 'awaiting_approval',
      error: 'Patch requires approval before apply: patch touches 2 files',
    });

    const updatedTicket = await repository.getTicket(ticket.id);
    const attempts = await repository.listAttempts(ticket.id);
    const events = await repository.listEvents(ticket.id);

    assert.equal(updatedTicket?.status, 'awaiting_approval');
    assert.equal(updatedTicket?.error, 'Patch requires approval before apply: patch touches 2 files');
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0]?.status, 'awaiting_approval');
    assert.ok(events.some((event) => event.type === 'approval-requested'));

    await repository.stop();
  });

  it('persists bounded tool artifacts onto the active attempt', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'Hephaestus-task-store-'));
    tempDirs.push(rootDir);

    const repository = new TicketStoreRepository({
      tasksFile: path.join(rootDir, 'TASKS.md'),
      storeFile: path.join(rootDir, '.hephaestus-tickets.db'),
      importLegacyTaskBoardIfStoreEmpty: false,
      projectionEnabled: false,
    });

    const ticket = await repository.createTicket('Capture tool artifacts');
    await repository.markTaskInProgress(ticket);
    await repository.appendTaskAttemptArtifacts(ticket.id, [
      '[corr_demo] file.read README.md -> success: file.read completed',
      '[corr_demo] command.run npm test -> denied: command is not allowlisted',
    ]);
    await repository.markTaskCompleted(withCompletedTask({
      ...ticket,
      status: 'in_progress',
    }));

    const attempts = await repository.listAttempts(ticket.id);

    assert.equal(attempts.length, 1);
    assert.deepEqual(attempts[0]?.artifacts, [
      '[corr_demo] file.read README.md -> success: file.read completed',
      '[corr_demo] command.run npm test -> denied: command is not allowlisted',
    ]);

    await repository.stop();
  });
});
