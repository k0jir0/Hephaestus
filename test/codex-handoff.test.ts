import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { exportCodexHandoffBundles } from '../src/codex-handoff.js';
import { TicketStoreRepository } from '../src/task-store.js';
import type { TaskAttempt, TaskEvent, TaskTicket } from '../src/types.js';

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const tempDir = tempDirs.pop();
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }
});

describe('codex handoff bundles', () => {
  it('exports active-ticket handoff bundles with lane routing metadata', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'Hephaestus-codex-handoff-'));
    tempDirs.push(rootDir);

    const repository = new TicketStoreRepository({
      tasksFile: path.join(rootDir, 'TASKS.md'),
      storeFile: path.join(rootDir, '.hephaestus-tickets.db'),
      importLegacyTaskBoardIfStoreEmpty: false,
      projectionEnabled: false,
    });

    const fastTicket = await repository.createTicket('Fix typo in efficiency report heading');
    await repository.markTaskInProgress(fastTicket);

    const deepTicket = await repository.createTicket(
      'Plan architecture migration for performance-sensitive database protocol refactor with safety constraints'
    );
    await repository.markTaskInProgress(deepTicket);
    await repository.markTaskBlocked({
      ...deepTicket,
      status: 'blocked',
      error: 'Needs design approval before implementation.',
    });

    const outputRoot = path.join(rootDir, 'handoff-out');
    const exported = await exportCodexHandoffBundles(repository, {
      outputRoot,
      statuses: ['in_progress', 'blocked'],
      generatedAt: new Date('2026-05-28T00:00:00.000Z'),
    });

    assert.equal(exported.length, 2);

    const fastBundlePath = exported.find((entry) => entry.ticketId === fastTicket.id)?.outputFile;
    const deepBundlePath = exported.find((entry) => entry.ticketId === deepTicket.id)?.outputFile;
    assert.ok(fastBundlePath);
    assert.ok(deepBundlePath);

    const fastBundle = JSON.parse(await fs.readFile(fastBundlePath!, 'utf-8')) as {
      version: string;
      lane: string;
      laneReason: string;
      ticket: { id: string };
    };
    const deepBundle = JSON.parse(await fs.readFile(deepBundlePath!, 'utf-8')) as {
      version: string;
      lane: string;
      laneReason: string;
      ticket: { id: string };
    };

    assert.equal(fastBundle.version, 'hephaestus-codex-handoff/v1');
    assert.equal(fastBundle.ticket.id, fastTicket.id);
    assert.equal(fastBundle.lane, 'fast');

    assert.equal(deepBundle.version, 'hephaestus-codex-handoff/v1');
    assert.equal(deepBundle.ticket.id, deepTicket.id);
    assert.equal(deepBundle.lane, 'deep');
    assert.match(deepBundle.laneReason, /blocked|complexity|retry|approval/i);

    await repository.stop();
  });

  it('uses bulk attempts and bounded recent events when repository support is available', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'Hephaestus-codex-handoff-'));
    tempDirs.push(rootDir);

    const generatedAt = new Date('2026-05-28T00:00:00.000Z');
    const tickets: TaskTicket[] = [
      {
        id: 'ticket_fast_1',
        description: 'Update one small metric label',
        status: 'pending',
        createdAt: generatedAt,
        updatedAt: generatedAt,
        attemptCount: 1,
        sourceOrder: 1,
      },
      {
        id: 'ticket_fast_2',
        description: 'Update one small handoff label',
        status: 'pending',
        createdAt: generatedAt,
        updatedAt: generatedAt,
        attemptCount: 1,
        sourceOrder: 2,
      },
    ];
    const attemptsByTicket = new Map<string, TaskAttempt[]>(
      tickets.map((ticket) => [
        ticket.id,
        [{
          id: `attempt_${ticket.id}`,
          ticketId: ticket.id,
          attemptNumber: 1,
          status: 'blocked',
          startedAt: generatedAt,
          endedAt: generatedAt,
          error: 'Command is not allowlisted: npm test',
          artifacts: [`[admission_${ticket.id}] backend.ollama model=codellama`],
        }],
      ])
    );
    const calls = {
      listAttempts: 0,
      listAttemptsForTickets: 0,
      listEvents: 0,
      listRecentEvents: 0,
    };
    const repository = {
      async listTickets() {
        return tickets;
      },
      async listAttempts(ticketId: string) {
        calls.listAttempts += 1;
        return attemptsByTicket.get(ticketId) ?? [];
      },
      async listAttemptsForTickets(ticketIds?: string[]) {
        calls.listAttemptsForTickets += 1;
        return new Map((ticketIds ?? []).map((ticketId) => [ticketId, attemptsByTicket.get(ticketId) ?? []]));
      },
      async listEvents(ticketId?: string) {
        calls.listEvents += 1;
        return ticketId ? [buildEvent(ticketId, generatedAt)] : tickets.map((ticket) => buildEvent(ticket.id, generatedAt));
      },
      async listRecentEvents(options?: { ticketId?: string; limit?: number }) {
        calls.listRecentEvents += 1;
        assert.equal(options?.limit, 8);
        return options?.ticketId ? [buildEvent(options.ticketId, generatedAt)] : [];
      },
    };

    const exported = await exportCodexHandoffBundles(repository, {
      outputRoot: path.join(rootDir, 'handoff-out'),
      statuses: ['pending'],
      generatedAt,
    });

    assert.equal(exported.length, 2);
    assert.equal(calls.listAttemptsForTickets, 1);
    assert.equal(calls.listAttempts, 0);
    assert.equal(calls.listRecentEvents, 2);
    assert.equal(calls.listEvents, 0);
  });
});

function buildEvent(ticketId: string, createdAt: Date): TaskEvent {
  return {
    ticketId,
    type: 'created',
    createdAt,
  };
}
