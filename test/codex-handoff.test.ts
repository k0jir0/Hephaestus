import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { exportCodexHandoffBundles } from '../src/codex-handoff.js';
import { TicketStoreRepository } from '../src/task-store.js';

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
});
