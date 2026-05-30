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

  it('persists workspace binding metadata on the active attempt', async () => {
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
    assert.ok(task);
    await repository.markTaskInProgress(task);
    await repository.bindCurrentAttemptWorkspace(task.id, {
      workspaceId: 'workspace_demo',
      workspaceRoot: path.resolve(fixture.rootDir),
      isolationMode: 'shared-root',
    });

    const attempts = await repository.listAttempts(task.id);
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0]?.workspaceId, 'workspace_demo');
    assert.equal(attempts[0]?.workspaceRoot, path.resolve(fixture.rootDir));
    assert.equal(attempts[0]?.isolationMode, 'shared-root');

    await repository.stop();
  });

  it('persists worker versions and promotion records with guarded lifecycle transitions', async () => {
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
    assert.ok(task);
    await repository.markTaskInProgress(task);
    await repository.bindCurrentAttemptWorkspace(task.id, {
      workspaceId: 'workspace_d5',
      workspaceRoot: path.resolve(fixture.rootDir),
      isolationMode: 'isolated-workspace',
    });

    const [attempt] = await repository.listAttempts(task.id);
    assert.ok(attempt);

    const workerVersion = await repository.createWorkerVersion({
      attemptId: attempt.id,
      patchBundlePath: path.join(fixture.rootDir, 'bundle.patch'),
      verificationSummary: 'build and tests passed',
    });
    assert.equal(workerVersion.status, 'candidate');
    assert.equal(workerVersion.workspaceId, 'workspace_d5');
    assert.equal(workerVersion.patchBundlePath, path.join(fixture.rootDir, 'bundle.patch'));

    const promotableVersion = await repository.updateWorkerVersionStatus(workerVersion.id, 'promotable');
    const activeVersion = await repository.updateWorkerVersionStatus(promotableVersion.id, 'active');
    assert.equal(promotableVersion.status, 'promotable');
    assert.equal(activeVersion.status, 'active');
    assert.ok(activeVersion.activatedAt instanceof Date);

    const promotion = await repository.createPromotionRecord({
      workerVersionId: workerVersion.id,
      approvedBy: 'approver@example.com',
      approvalId: 'approval_d5',
    });
    assert.equal(promotion.status, 'requested');

    await repository.updatePromotionStatus(promotion.id, 'verified');
    await repository.updatePromotionStatus(promotion.id, 'started');
    await repository.updatePromotionStatus(promotion.id, 'health_check_passed');
    const completedPromotion = await repository.updatePromotionStatus(promotion.id, 'completed');
    assert.equal(completedPromotion.status, 'completed');

    const repeatedCompletedPromotion = await repository.updatePromotionStatus(promotion.id, 'completed');
    assert.equal(repeatedCompletedPromotion.status, 'completed');

    await assert.rejects(
      () => repository.updatePromotionStatus(promotion.id, 'verified'),
      /Invalid promotion transition/
    );

    const promotionEvents = (await repository.listEvents(task.id))
      .filter((event) => event.type.startsWith('promotion.'));
    assert.deepEqual(
      promotionEvents.map((event) => event.type),
      [
        'promotion.requested',
        'promotion.verified',
        'promotion.started',
        'promotion.health_check_passed',
        'promotion.completed',
      ]
    );
    assert.equal(promotionEvents.filter((event) => event.type === 'promotion.completed').length, 1);

    const promotions = await repository.listPromotionRecords(workerVersion.id);
    assert.equal(promotions.length, 1);
    assert.equal(promotions[0]?.approvalId, 'approval_d5');

    const workerVersions = await repository.listWorkerVersions(attempt.id);
    assert.equal(workerVersions.length, 1);
    assert.equal(workerVersions[0]?.status, 'active');

    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(fixture.ticketStoreFile);
    const migrationRow = db
      .prepare('select count(*) as count from schema_migrations where version = 7')
      .get() as { count: number };
    db.close();
    assert.equal(migrationRow.count, 1);

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
    const blockedTicket = await repository.createTicket('Retry demo for D2 replay using ChandyLamport1985', {
      status: 'blocked',
    });

    assert.equal(pendingTicket.status, 'pending');
    assert.equal(blockedTicket.status, 'blocked');
    await assert.rejects(fs.access(tasksFile), /ENOENT/);

    const retriedTicket = await repository.retryTicket(blockedTicket.id, {
      amendedDescription: 'Retry demo with narrower scope using Yao2023ReAct',
    });
    assert.equal(retriedTicket.status, 'pending');
    assert.equal(retriedTicket.description, 'Retry demo with narrower scope using Yao2023ReAct');
    assert.equal(retriedTicket.plan, undefined);
    assert.equal(retriedTicket.toolCalls, undefined);
    assert.equal(retriedTicket.approval, undefined);

    const cancelledTicket = await repository.cancelTicket(pendingTicket.id, 'No longer needed');
    assert.equal(cancelledTicket.status, 'cancelled');

    const supersededTicket = await repository.supersedeTicket(retriedTicket.id, 'Covered by a newer ticket');
    assert.equal(supersededTicket.status, 'superseded');

    const allTickets = await repository.listTickets();
    assert.equal(allTickets.length, 2);
    assert.equal(
      allTickets.filter((ticket) => ticket.status === 'pending').length,
      0
    );
    assert.equal(
      allTickets.filter((ticket) => ticket.status === 'cancelled').length,
      1
    );
    assert.equal(
      allTickets.filter((ticket) => ticket.status === 'superseded').length,
      1
    );

    const board = await repository.renderTaskBoardProjection();
    assert.match(board, /Build demo/);
    assert.match(board, /Retry demo with narrower scope using Yao2023ReAct/);

    const events = await repository.listEvents(blockedTicket.id);
    const createdEvent = events.find((event) => event.type === 'created');
    const amendedEvent = events.find((event) => event.type === 'amended');
    const requeuedEvent = events.find((event) => event.type === 'requeued');
    assert.ok(events.some((event) => event.type === 'amended'));
    assert.ok(events.some((event) => event.type === 'requeued'));
    assert.ok(events.some((event) => event.type === 'superseded'));
    assert.equal(typeof createdEvent?.evidence?.sourceOrder, 'number');
    assert.equal(typeof createdEvent?.evidence?.descriptionKey, 'string');
    assert.deepEqual(createdEvent?.evidence?.sourceGroundingKeys, ['ChandyLamport1985']);
    assert.deepEqual(amendedEvent?.evidence?.sourceGroundingKeysBefore, ['ChandyLamport1985']);
    assert.deepEqual(amendedEvent?.evidence?.sourceGroundingKeysAfter, ['Yao2023ReAct']);
    assert.deepEqual(requeuedEvent?.evidence?.sourceGroundingKeys, ['Yao2023ReAct']);

    await repository.stop();
  });

  it('dual-writes lifecycle events to domain_events and persists structured event_evidence rows', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'Hephaestus-task-store-'));
    tempDirs.push(rootDir);

    const ticketStoreFile = path.join(rootDir, '.hephaestus-tickets.db');
    const repository = new TicketStoreRepository({
      tasksFile: path.join(rootDir, 'TASKS.md'),
      storeFile: ticketStoreFile,
      importLegacyTaskBoardIfStoreEmpty: false,
      projectionEnabled: false,
    });

    const ticket = await repository.createTicket(
      'Implement D2 dual-write in src/task-store.ts using ChandyLamport1985 and verify with npm run test; expected signal: tests exit 0.',
      { status: 'blocked' }
    );
    await repository.retryTicket(ticket.id, {
      amendedDescription:
        'Implement D2 event evidence rows in src/task-store.ts using Yao2023ReAct and verify with npm run test; expected signal: tests exit 0.',
    });

    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(ticketStoreFile);

    const migrationRow = db
      .prepare('select count(*) as count from schema_migrations where version = 5')
      .get() as { count: number };
    const legacyEvents = db
      .prepare('select count(*) as count from ticket_events where ticket_id = ?')
      .get(ticket.id) as { count: number };
    const domainEvents = db
      .prepare('select count(*) as count from domain_events where ticket_id = ?')
      .get(ticket.id) as { count: number };
    const evidenceRows = db
      .prepare('select count(*) as count from event_evidence where ticket_id = ?')
      .get(ticket.id) as { count: number };

    db.close();

    assert.equal(migrationRow.count, 1);
    assert.ok(legacyEvents.count >= 2);
    assert.equal(domainEvents.count, legacyEvents.count);
    assert.ok(evidenceRows.count > 0);

    await repository.stop();
  });

  it('reads events from canonical domain_events when legacy rows are unavailable', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'Hephaestus-task-store-'));
    tempDirs.push(rootDir);

    const ticketStoreFile = path.join(rootDir, '.hephaestus-tickets.db');
    const repository = new TicketStoreRepository({
      tasksFile: path.join(rootDir, 'TASKS.md'),
      storeFile: ticketStoreFile,
      importLegacyTaskBoardIfStoreEmpty: false,
      projectionEnabled: false,
    });

    const ticket = await repository.createTicket('Canonical event read fallback check');
    await repository.cancelTicket(ticket.id, 'No longer needed');

    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(ticketStoreFile);
    db.prepare('delete from ticket_events where ticket_id = ?').run(ticket.id);
    db.close();

    const events = await repository.listEvents(ticket.id);
    assert.ok(events.length > 0);
    assert.ok(events.some((event) => event.type === 'created'));
    assert.ok(events.some((event) => event.type === 'cancelled'));

    await repository.stop();
  });

  it('reports D2 event spine parity snapshot for legacy and canonical streams', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'Hephaestus-task-store-'));
    tempDirs.push(rootDir);

    const repository = new TicketStoreRepository({
      tasksFile: path.join(rootDir, 'TASKS.md'),
      storeFile: path.join(rootDir, '.hephaestus-tickets.db'),
      importLegacyTaskBoardIfStoreEmpty: false,
      projectionEnabled: false,
    });

    const ticket = await repository.createTicket('D2 parity snapshot check');
    await repository.cancelTicket(ticket.id, 'Done');

    const snapshot = await repository.getD2EventSpineSnapshot();
    assert.ok(snapshot.legacyEventCount > 0);
    assert.ok(snapshot.domainEventCount >= snapshot.legacyEventCount);
    assert.ok(snapshot.domainEventsWithLegacyLink > 0);
    assert.equal(snapshot.ticketsWithLegacyOnly.length, 0);
    assert.equal(snapshot.ticketsWithDomainOnly.length, 0);
    assert.equal(snapshot.ticketsWithCountMismatch.length, 0);

    await repository.stop();
  });

  it('backfills legacy ticket_events into canonical spine idempotently across restarts', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'Hephaestus-task-store-'));
    tempDirs.push(rootDir);

    const tasksFile = path.join(rootDir, 'TASKS.md');
    const ticketStoreFile = path.join(rootDir, '.hephaestus-tickets.db');
    const firstRepository = new TicketStoreRepository({
      tasksFile,
      storeFile: ticketStoreFile,
      importLegacyTaskBoardIfStoreEmpty: false,
      projectionEnabled: false,
    });

    const ticket = await firstRepository.createTicket('Backfill canonical spine coverage');
    await firstRepository.cancelTicket(ticket.id, 'Backfill test');
    await firstRepository.stop();

    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(ticketStoreFile);
    db.prepare('delete from event_evidence').run();
    db.prepare('delete from domain_events').run();
    const legacyBefore = (db.prepare('select count(*) as count from ticket_events').get() as { count: number }).count;
    db.close();

    const secondRepository = new TicketStoreRepository({
      tasksFile,
      storeFile: ticketStoreFile,
      importLegacyTaskBoardIfStoreEmpty: false,
      projectionEnabled: false,
    });

    const firstSnapshot = await secondRepository.getD2EventSpineSnapshot();
    assert.equal(firstSnapshot.legacyEventCount, legacyBefore);
    assert.equal(firstSnapshot.domainEventCount, legacyBefore);
    assert.equal(firstSnapshot.ticketsWithLegacyOnly.length, 0);
    assert.equal(firstSnapshot.ticketsWithCountMismatch.length, 0);
    assert.ok(firstSnapshot.eventEvidenceCount > 0);
    await secondRepository.stop();

    const thirdRepository = new TicketStoreRepository({
      tasksFile,
      storeFile: ticketStoreFile,
      importLegacyTaskBoardIfStoreEmpty: false,
      projectionEnabled: false,
    });

    const secondSnapshot = await thirdRepository.getD2EventSpineSnapshot();
    assert.equal(secondSnapshot.legacyEventCount, firstSnapshot.legacyEventCount);
    assert.equal(secondSnapshot.domainEventCount, firstSnapshot.domainEventCount);
    assert.equal(secondSnapshot.eventEvidenceCount, firstSnapshot.eventEvidenceCount);
    assert.equal(secondSnapshot.ticketsWithLegacyOnly.length, 0);
    assert.equal(secondSnapshot.ticketsWithCountMismatch.length, 0);
    await thirdRepository.stop();
  });

  it('produces deterministic D2 replay summaries from canonical domain events', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'Hephaestus-task-store-'));
    tempDirs.push(rootDir);

    const repository = new TicketStoreRepository({
      tasksFile: path.join(rootDir, 'TASKS.md'),
      storeFile: path.join(rootDir, '.hephaestus-tickets.db'),
      importLegacyTaskBoardIfStoreEmpty: false,
      projectionEnabled: false,
    });

    const ticket = await repository.createTicket('Replay summary determinism check');
    await repository.cancelTicket(ticket.id, 'Done');

    const summaryA = await repository.getD2ReplaySummary();
    const summaryB = await repository.getD2ReplaySummary();

    assert.ok(summaryA.totalEvents > 0);
    assert.ok(summaryA.ticketCount > 0);
    assert.equal(summaryA.replayHash, summaryB.replayHash);
    assert.equal(summaryA.totalEvents, summaryB.totalEvents);
    assert.ok(summaryA.correlationCoverage >= 0);
    assert.ok(summaryA.correlationCoverage <= 1);

    await repository.stop();
  });

  it('loads attempts in bulk and exposes an aggregate revision stamp', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'Hephaestus-task-store-'));
    tempDirs.push(rootDir);

    const repository = new TicketStoreRepository({
      tasksFile: path.join(rootDir, 'TASKS.md'),
      storeFile: path.join(rootDir, '.hephaestus-tickets.db'),
      importLegacyTaskBoardIfStoreEmpty: false,
      projectionEnabled: false,
    });

    const completed = await repository.createTicket('Bulk attempt completed');
    await repository.markTaskInProgress(completed);
    await repository.markTaskCompleted(withCompletedTask(completed));

    const blocked = await repository.createTicket('Bulk attempt blocked');
    await repository.markTaskInProgress(blocked);
    await repository.markTaskBlocked({
      ...blocked,
      status: 'blocked',
      error: 'Command failed: npm test',
    });

    const attemptsByTicket = await repository.listAttemptsForTickets([
      completed.id,
      blocked.id,
      'ticket_missing',
    ]);
    assert.equal(attemptsByTicket.get(completed.id)?.length, 1);
    assert.equal(attemptsByTicket.get(blocked.id)?.length, 1);
    assert.deepEqual(attemptsByTicket.get('ticket_missing'), []);

    const counts = await repository.getTicketCounts();
    assert.equal(counts.total, 2);
    assert.equal(counts.completed, 1);
    assert.equal(counts.blocked, 1);

    const recentEvents = await repository.listRecentEvents({ limit: 2 });
    assert.equal(recentEvents.length, 2);
    assert.ok(recentEvents[0]!.createdAt.getTime() >= recentEvents[1]!.createdAt.getTime());

    const blockedEvents = await repository.listRecentEvents({ ticketId: blocked.id, limit: 3 });
    assert.ok(blockedEvents.length > 0);
    assert.ok(blockedEvents.every((event) => event.ticketId === blocked.id));

    const latestEventAt = await repository.getLatestEventTimestamp();
    const latestCreatedAt = await repository.getLatestEventTimestamp('created');
    assert.ok(latestEventAt instanceof Date);
    assert.ok(latestCreatedAt instanceof Date);

    const revision = await repository.getRevisionStamp();
    assert.equal(revision.ticketCount, 2);
    assert.ok(revision.eventCount >= 6);
    assert.equal(
      revision.value,
      [
        revision.ticketCount,
        revision.latestTicketUpdateMs,
        revision.eventCount,
        revision.latestEventMs,
      ].join(':')
    );

    await repository.retryTicket(blocked.id);
    const nextRevision = await repository.getRevisionStamp();
    assert.ok(nextRevision.eventCount > revision.eventCount);
    assert.notEqual(nextRevision.value, revision.value);

    await repository.stop();
  });

  it('recovers stale active tickets on startup and retries them with a fresh attempt number', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'Hephaestus-task-store-'));
    tempDirs.push(rootDir);

    const tasksFile = path.join(rootDir, 'TASKS.md');
    const ticketStoreFile = path.join(rootDir, '.hephaestus-tickets.db');
    const firstRepository = new TicketStoreRepository({
      tasksFile,
      storeFile: ticketStoreFile,
      importLegacyTaskBoardIfStoreEmpty: false,
      projectionEnabled: false,
      staleRecoveryMinAgeMs: 0,
    });

    const ticket = await firstRepository.createTicket('Recover a daemon crash');
    await firstRepository.markTaskInProgress(ticket);
    await firstRepository.stop();

    const secondRepository = new TicketStoreRepository({
      tasksFile,
      storeFile: ticketStoreFile,
      importLegacyTaskBoardIfStoreEmpty: false,
      projectionEnabled: false,
      staleRecoveryMinAgeMs: 0,
    });

    const recovered = await secondRepository.getTicket(ticket.id);
    const recoveredAttempts = await secondRepository.listAttempts(ticket.id);
    const recoveryEvents = await secondRepository.listEvents(ticket.id);

    assert.equal(recovered?.status, 'stale');
    assert.equal(recovered?.currentAttemptId, undefined);
    assert.match(recovered?.error ?? '', /Recovered stale active ticket/);
    assert.equal(recoveredAttempts.length, 1);
    assert.equal(recoveredAttempts[0]?.status, 'stale');
    assert.ok(recoveredAttempts[0]?.endedAt instanceof Date);
    assert.ok(recoveryEvents.some((event) => event.type === 'stale-recovered'));

    const retried = await secondRepository.retryTicket(ticket.id);
    await secondRepository.markTaskInProgress(retried);
    const retryAttempts = await secondRepository.listAttempts(ticket.id);

    assert.equal(retried.status, 'pending');
    assert.equal(retryAttempts.length, 2);
    assert.deepEqual(
      retryAttempts.map((attempt) => attempt.attemptNumber),
      [1, 2]
    );
    assert.equal(retryAttempts[1]?.status, 'in_progress');

    await secondRepository.stop();
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

    await waitFor(() => {
      const status = repository.getProjectionHealthStatus();
      return status.healthy && !status.retryScheduled;
    }, 1_000);

    const healthyStatus = repository.getProjectionHealthStatus();
    assert.equal(healthyStatus.healthy, true);
    assert.equal(healthyStatus.retryScheduled, false);
    assert.ok(writes >= 2);

    await repository.stop();
  });

  it('detects TASKS.md projection drift and repairs it from the canonical store', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'Hephaestus-task-store-'));
    tempDirs.push(rootDir);

    const tasksFile = path.join(rootDir, 'TASKS.md');
    const repository = new TicketStoreRepository({
      tasksFile,
      storeFile: path.join(rootDir, '.hephaestus-tickets.db'),
      importLegacyTaskBoardIfStoreEmpty: false,
      projectionEnabled: true,
    });

    await repository.createTicket('Detect projection drift');
    await fs.writeFile(tasksFile, '# stale manual projection\n', 'utf-8');

    const drifted = await repository.getProjectionDriftStatus();
    const readiness = await repository.getRepositoryReadiness();
    assert.equal(drifted.checked, true);
    assert.equal(drifted.drifted, true);
    assert.ok(readiness.some((issue) => issue.code === 'task-board-projection-drift'));

    await repository.syncProjection();
    const repaired = await repository.getProjectionDriftStatus();
    assert.equal(repaired.drifted, false);

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
    const enqueuedEvent = events.find(
      (event) => event.type === 'side-effect-enqueued' && event.correlationId === 'corr_demo'
    );
    const completedEvent = events.find(
      (event) => event.type === 'side-effect-completed' && event.correlationId === 'corr_demo'
    );
    const failedEvent = events.find(
      (event) => event.type === 'side-effect-failed' && event.correlationId === 'corr_demo'
    );

    assert.equal(sideEffects.length, 2);
    assert.equal(duplicate.length, 1);
    assert.equal(persisted.length, 2);
    assert.equal(persisted[0]!.status, 'completed');
    assert.equal(persisted[1]!.status, 'failed');
    assert.equal(persisted[1]!.lastError, 'disk full');
    assert.ok(events.some((event) => event.type === 'side-effect-enqueued' && event.correlationId === 'corr_demo'));
    assert.ok(events.some((event) => event.type === 'side-effect-completed' && event.correlationId === 'corr_demo'));
    assert.ok(events.some((event) => event.type === 'side-effect-failed' && event.correlationId === 'corr_demo'));
    assert.equal(enqueuedEvent?.evidence?.status, 'pending');
    assert.equal(completedEvent?.evidence?.status, 'completed');
    assert.equal(failedEvent?.evidence?.status, 'failed');
    assert.equal(failedEvent?.evidence?.error, 'disk full');

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

  it('approves and resumes awaiting-approval tickets with durable audit metadata', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'Hephaestus-task-store-'));
    tempDirs.push(rootDir);

    const repository = new TicketStoreRepository({
      tasksFile: path.join(rootDir, 'TASKS.md'),
      storeFile: path.join(rootDir, '.hephaestus-tickets.db'),
      importLegacyTaskBoardIfStoreEmpty: false,
      projectionEnabled: false,
    });

    const ticket = await repository.createTicket('Resume an approved patch');
    await repository.markTaskInProgress(ticket);
    await repository.markTaskAwaitingApproval({
      ...ticket,
      status: 'awaiting_approval',
      error: 'Patch requires approval before apply: patch touches 2 files',
      plan: {
        summary: 'Apply the risky patch.',
        intendedFiles: [
          { path: 'README.md', changeType: 'update', purpose: 'Update docs' },
          { path: 'src/runtime.ts', changeType: 'update', purpose: 'Update runtime behavior' },
        ],
        commands: [],
        verification: ['Review the approval request'],
        risks: ['Touches multiple files'],
      },
      toolCalls: [
        {
          name: 'patch.apply',
          arguments: {
            patch: 'diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-old\n+new\n',
          },
        },
      ],
      approval: {
        requestId: 'approval_req_1',
        status: 'requested',
        requestedAt: new Date('2026-05-27T00:00:00.000Z'),
        requestedReason: 'Patch requires approval before apply: patch touches 2 files',
        touchedPaths: ['README.md', 'src/runtime.ts'],
        changedLines: 24,
      },
    });

    const approved = await repository.approveTicket(ticket.id, 'operator@example.com', 'Reviewed and approved.');
    const resumed = await repository.resumeApprovedTicket(ticket.id);
    const attempts = await repository.listAttempts(ticket.id);
    const events = await repository.listEvents(ticket.id);

    assert.equal(approved.status, 'awaiting_approval');
    assert.equal(approved.approval?.status, 'approved');
    assert.equal(approved.approval?.reviewer, 'operator@example.com');
    assert.equal(approved.approval?.rationale, 'Reviewed and approved.');
    assert.match(approved.approval?.approvalId ?? '', /^approval_[a-z0-9]+$/i);

    assert.equal(resumed.status, 'pending');
    assert.equal(resumed.approval?.status, 'approved');
    assert.equal(resumed.toolCalls?.length, 1);
    assert.equal(attempts[0]?.status, 'awaiting_approval');
    assert.equal(attempts[0]?.approval?.status, 'approved');
    assert.equal(attempts[0]?.toolCalls?.[0]?.name, 'patch.apply');
    assert.ok(events.some((event) => event.type === 'approval-requested'));
    assert.ok(events.some((event) => event.type === 'approval-approved'));
    assert.ok(events.some((event) => event.type === 'approval-resumed'));

    await repository.stop();
  });

  it('blocks awaiting-approval tickets when an operator rejects the request', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'Hephaestus-task-store-'));
    tempDirs.push(rootDir);

    const repository = new TicketStoreRepository({
      tasksFile: path.join(rootDir, 'TASKS.md'),
      storeFile: path.join(rootDir, '.hephaestus-tickets.db'),
      importLegacyTaskBoardIfStoreEmpty: false,
      projectionEnabled: false,
    });

    const ticket = await repository.createTicket('Reject a risky patch');
    await repository.markTaskInProgress(ticket);
    await repository.markTaskAwaitingApproval({
      ...ticket,
      status: 'awaiting_approval',
      error: 'Patch requires approval before apply: patch touches 2 files',
      toolCalls: [
        {
          name: 'patch.apply',
          arguments: {
            patch: 'diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-old\n+new\n',
          },
        },
      ],
      approval: {
        requestId: 'approval_req_2',
        status: 'requested',
        requestedAt: new Date('2026-05-27T00:00:00.000Z'),
        requestedReason: 'Patch requires approval before apply: patch touches 2 files',
      },
    });

    const rejected = await repository.rejectTicket(ticket.id, 'operator@example.com', 'Too broad for this milestone.');
    const events = await repository.listEvents(ticket.id);

    assert.equal(rejected.status, 'blocked');
    assert.equal(rejected.approval?.status, 'rejected');
    assert.equal(rejected.approval?.reviewer, 'operator@example.com');
    assert.match(rejected.error ?? '', /Approval rejected by operator@example.com: Too broad for this milestone\./);
    assert.ok(events.some((event) => event.type === 'approval-rejected'));
    assert.ok(events.some((event) => event.type === 'blocked' && /Approval rejected/.test(event.details ?? '')));

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
