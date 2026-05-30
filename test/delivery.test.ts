import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { exportPatchBundle } from '../src/delivery.js';
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

describe('exportPatchBundle', () => {
  it('exports patch calls with durable provenance files', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'Hephaestus-delivery-'));
    tempDirs.push(rootDir);

    const repository = new TicketStoreRepository({
      tasksFile: path.join(rootDir, 'TASKS.md'),
      storeFile: path.join(rootDir, '.hephaestus-tickets.db'),
      importLegacyTaskBoardIfStoreEmpty: false,
      projectionEnabled: false,
    });

    const ticket = await repository.createTicket('Export a patch bundle');
    await repository.markTaskInProgress(ticket);
    await repository.bindCurrentAttemptWorkspace(ticket.id, {
      workspaceId: 'workspace_delivery_demo',
      workspaceRoot: path.resolve(rootDir, '.hephaestus', 'workspaces', 'workspace_delivery_demo'),
      isolationMode: 'shared-root',
    });
    await repository.markTaskAwaitingApproval({
      ...ticket,
      status: 'awaiting_approval',
      error: 'Patch requires approval before apply: patch touches 1 file',
      toolCalls: [
        {
          name: 'patch.apply',
          arguments: {
            patch: [
              'diff --git a/README.md b/README.md',
              '--- a/README.md',
              '+++ b/README.md',
              '@@ -1 +1 @@',
              '-old',
              '+new',
              '',
            ].join('\n'),
          },
        },
      ],
    });

    const bundle = await exportPatchBundle(repository, ticket.id, {
      outputRoot: path.join(rootDir, 'delivery'),
      generatedAt: new Date('2026-05-28T00:00:00.000Z'),
    });

    const patch = await fs.readFile(bundle.patchFile, 'utf-8');
    const manifest = JSON.parse(await fs.readFile(bundle.manifestFile, 'utf-8')) as {
      version: string;
      ticket: { id: string; status: string };
      workspaceProvenance?: { modes: string[]; workspaceIds: string[] };
      patches: unknown[];
    };
    const readme = await fs.readFile(bundle.readmeFile, 'utf-8');

    assert.equal(bundle.patchCount, 1);
    assert.match(patch, /diff --git a\/README\.md b\/README\.md/);
    assert.equal(manifest.version, 'hephaestus-patch-bundle/v1');
    assert.equal(manifest.ticket.id, ticket.id);
    assert.equal(manifest.ticket.status, 'awaiting_approval');
    assert.equal(manifest.patches.length, 1);
    assert.deepEqual(manifest.workspaceProvenance?.modes, ['shared-root']);
    assert.deepEqual(manifest.workspaceProvenance?.workspaceIds, ['workspace_delivery_demo']);
    assert.match(readme, /git apply --check bundle\.patch/);
    assert.match(readme, /Workspace mode\(s\): shared-root/);

    await repository.stop();
  });
});
