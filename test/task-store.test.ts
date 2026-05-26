import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
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
    });

    const pendingTicket = await repository.createTicket('Build demo');
    const blockedTicket = await repository.createTicket('Retry demo', {
      status: 'blocked',
    });

    assert.equal(pendingTicket.status, 'pending');
    assert.equal(blockedTicket.status, 'blocked');

    const retriedTicket = await repository.retryTicket(blockedTicket.id);
    assert.equal(retriedTicket.status, 'pending');

    const allTickets = await repository.listTickets();
    assert.equal(allTickets.length, 2);
    assert.equal(
      allTickets.filter((ticket) => ticket.status === 'pending').length,
      2
    );

    const board = await repository.renderTaskBoardProjection();
    assert.match(board, /Build demo/);
    assert.match(board, /Retry demo/);

    const events = await repository.listEvents(blockedTicket.id);
    assert.ok(events.some((event) => event.type === 'requeued'));

    await repository.stop();
  });
});
