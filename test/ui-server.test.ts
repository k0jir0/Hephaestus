import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, it } from 'node:test';
import { UIServer } from '../src/ui-server.js';
import { TicketStoreRepository } from '../src/task-store.js';

const tempDirs: string[] = [];

async function createFixture(): Promise<{
  rootDir: string;
  tasksFile: string;
  ticketStoreFile: string;
  baselineFile: string;
}> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'Hephaestus-ui-'));
  tempDirs.push(rootDir);

  const tasksFile = path.join(rootDir, 'TASKS.md');
  const ticketStoreFile = path.join(rootDir, '.hephaestus-tickets.db');
  const baselineDir = path.join(rootDir, 'docs');
  const baselineFile = path.join(baselineDir, 'reliability-baselines.md');

  await fs.mkdir(baselineDir, { recursive: true });
  await fs.writeFile(tasksFile, '# Hephaestus Task Queue\n\n## Queue\n\n- (empty)\n', 'utf-8');
  await fs.writeFile(
    baselineFile,
    '# Hephaestus Reliability Baselines\n\nState consistency lag (ms): 0\nAverage admission-to-start latency (ms): 4.33\nBlocked-retry success ratio: 0.50\nExecution failure taxonomy stability: 0.33\nAwaiting approval tickets: 3\n',
    'utf-8'
  );

  return { rootDir, tasksFile, ticketStoreFile, baselineFile };
}

async function seedRepository(
  repository: TicketStoreRepository,
  rootDir: string,
): Promise<{
  blockedId: string;
  awaitingApprovalId: string;
  promotedId: string;
}> {
  const pending = await repository.createTicket('Inspect the runtime board');

  const blocked = await repository.createTicket('Retry a blocked runtime');
  await repository.markTaskInProgress(blocked);
  await repository.markTaskBlocked({
    ...blocked,
    status: 'blocked',
    error: 'Backend timeout: the model did not respond in time',
  });

  const approval = await repository.createTicket('Approve a risky patch');
  await repository.markTaskInProgress(approval);
  await repository.appendTaskAttemptArtifacts(approval.id, [
    '[approval_req_1] policy.snapshot [policy1234abcd5678] {"version":"hephaestus-tool-policy/v1","dryRunByDefault":false}',
    '[approval_req_1] patch.delta README.md, src/runtime.ts: dry-run=dry_run/dry-run-only; apply=denied/approval-required; mutatedPaths=README.md,src/runtime.ts',
  ]);
  await repository.markTaskAwaitingApproval({
    ...approval,
    status: 'awaiting_approval',
    error: 'Patch requires approval before apply: patch touches 2 files',
    plan: {
      summary: 'Apply a risky patch.',
      intendedFiles: [
        { path: 'README.md', changeType: 'update', purpose: 'Update documentation' },
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

  const promoted = await repository.createTicket('Inspect promotion DTOs');
  await repository.markTaskInProgress(promoted);
  await repository.markTaskCompleted({
    ...promoted,
    status: 'completed',
    result: 'Promotion is ready',
  });
  const [promotedAttempt] = await repository.listAttempts(promoted.id);
  assert.ok(promotedAttempt);
  const promotedWorkerVersion = await repository.createWorkerVersion({
    attemptId: promotedAttempt.id,
    workspaceId: 'workspace_promoted',
    workspaceRoot: rootDir,
    patchBundlePath: path.join(rootDir, 'promotion.patch'),
    verificationSummary: 'build and tests passed',
  });
  await repository.updateWorkerVersionStatus(promotedWorkerVersion.id, 'promotable');
  await repository.updateWorkerVersionStatus(promotedWorkerVersion.id, 'active');
  const promotedRecord = await repository.createPromotionRecord({
    workerVersionId: promotedWorkerVersion.id,
    approvedBy: 'approver@example.com',
    approvalId: 'approval-promoted',
  });
  await repository.updatePromotionStatus(promotedRecord.id, 'verified');
  await repository.updatePromotionStatus(promotedRecord.id, 'started');
  await repository.updatePromotionStatus(promotedRecord.id, 'health_check_passed');
  await repository.updatePromotionStatus(promotedRecord.id, 'completed');

  assert.equal(pending.status, 'pending');
  return {
    blockedId: blocked.id,
    awaitingApprovalId: approval.id,
    promotedId: promoted.id,
  };
}

async function readSseChunk(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  const chunk = await reader.read();
  assert.equal(chunk.done, false);
  return new TextDecoder().decode(chunk.value);
}

async function fetchJson(url: string, token: string, init: RequestInit = {}): Promise<unknown> {
  const headers = new Headers(init.headers ?? {});
  headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(url, { ...init, headers });
  const payload = await response.json();
  assert.ok(response.ok, JSON.stringify(payload));
  return payload;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const directory = tempDirs.pop();
    if (directory) {
      await fs.rm(directory, { recursive: true, force: true });
    }
  }
});

  describe('UIServer', () => {
    it('serves the UI shell and query endpoints with role-aware access control', async () => {
    const fixture = await createFixture();
    const repository = new TicketStoreRepository({
      tasksFile: fixture.tasksFile,
      storeFile: fixture.ticketStoreFile,
      importLegacyTaskBoardIfStoreEmpty: false,
      projectionEnabled: false,
    });
    const seeded = await seedRepository(repository, fixture.rootDir);
      const server = new UIServer({
      host: '127.0.0.1',
      port: 0,
      repository,
      baselineFile: fixture.baselineFile,
      authTokens: [
        { role: 'viewer', token: 'viewer-token', label: 'Viewer' },
        { role: 'operator', token: 'operator-token', label: 'Operator' },
        { role: 'approver', token: 'approver-token', label: 'Approver' },
      ],
      sseIntervalMs: 50,
    });
    const { url } = await server.start();

    try {
      const html = await fetch(url);
      assert.equal(html.status, 200);
      assert.match(await html.text(), /Hephaestus Control Plane/);

      const health = await fetch(`${url}/health`);
      assert.equal(health.status, 200);
      const healthPayload = await health.json() as {
        status: string;
        counts: Record<string, number>;
        model: { activeModel: string; profile: { known: boolean } };
      };
      assert.equal(healthPayload.status, 'ok');
      assert.equal(healthPayload.counts.awaiting_approval, 1);
      assert.ok(healthPayload.model.activeModel.length > 0);

      const session = await fetchJson(`${url}/api/session`, 'viewer-token') as { role: string; permissions: string[] };
      assert.equal(session.role, 'viewer');
      assert.ok(session.permissions.includes('query'));

      const overview = await fetchJson(`${url}/api/overview`, 'viewer-token') as {
        metadata: {
          schemaVersion: string;
          revision: string;
          windows: { recentTickets: number; recentEvents: number };
          sources: { baselineAvailable: boolean; efficiencySnapshotAvailable: boolean };
        };
        ticketCounts: Record<string, number>;
        model: { activeModel: string; summary: string };
        recentTickets: Array<{ id: string }>;
      };
      assert.equal(overview.metadata.schemaVersion, 'overview.v1');
      assert.ok(overview.metadata.revision.length > 0);
      assert.equal(overview.metadata.windows.recentTickets, 12);
      assert.equal(overview.metadata.windows.recentEvents, 18);
      assert.equal(overview.metadata.sources.baselineAvailable, true);
      assert.equal(overview.ticketCounts.awaiting_approval, 1);
      assert.ok(overview.model.summary.length > 0);
      assert.ok(overview.recentTickets.length >= 3);

      const reliability = await fetchJson(`${url}/api/reliability`, 'viewer-token') as {
        metadata: {
          schemaVersion: string;
          revision: string;
          windows: { recentTickets: number; recentEvents: number };
          sources: { baselineAvailable: boolean; efficiencySnapshotAvailable: boolean };
        };
        recentEvents: unknown[];
      };
      assert.equal(reliability.metadata.schemaVersion, 'reliability.v1');
      assert.ok(reliability.metadata.revision.length > 0);
      assert.equal(reliability.metadata.windows.recentTickets, 0);
      assert.equal(reliability.metadata.windows.recentEvents, 24);
      assert.equal(reliability.metadata.sources.baselineAvailable, true);
      assert.ok(Array.isArray(reliability.recentEvents));

      const detail = await fetchJson(`${url}/api/tickets/${seeded.awaitingApprovalId}`, 'viewer-token') as {
        ticket: { id: string; status: string };
        workerVersions: Array<{ id: string; status: string }>;
        promotions: Array<{ id: string; status: string }>;
        derived: {
          currentPatch?: string;
          policySnapshots: unknown[];
          patchDeltas: unknown[];
          recoveryRecommendation: { family: string; recommendation: string };
        };
      };
      assert.equal(detail.ticket.id, seeded.awaitingApprovalId);
      assert.equal(detail.ticket.status, 'awaiting_approval');
      assert.equal(detail.workerVersions.length, 0);
      assert.equal(detail.promotions.length, 0);
      assert.match(detail.derived.currentPatch ?? '', /diff --git/);
      assert.equal(detail.derived.policySnapshots.length, 1);
      assert.equal(detail.derived.patchDeltas.length, 1);
      assert.equal(detail.derived.recoveryRecommendation.family, 'approval');
      assert.match(detail.derived.recoveryRecommendation.recommendation, /human review/);

      const promotedDetail = await fetchJson(`${url}/api/tickets/${seeded.promotedId}`, 'viewer-token') as {
        workerVersions: Array<{
          id: string;
          status: string;
          ticketId: string;
          attemptNumber: number;
          workspaceId?: string;
          workspaceRoot?: string;
          patchBundlePath?: string;
          verificationSummary?: string;
        }>;
        promotions: Array<{
          id: string;
          status: string;
          ticketId: string;
          attemptId: string;
          attemptNumber: number;
          workspaceId?: string;
          workspaceRoot?: string;
          patchBundlePath?: string;
          verificationSummary?: string;
          workerVersionStatus?: string;
        }>;
      };
      assert.equal(promotedDetail.workerVersions.length, 1);
      assert.equal(promotedDetail.promotions.length, 1);
      assert.equal(promotedDetail.workerVersions[0]?.ticketId, seeded.promotedId);
      assert.equal(promotedDetail.workerVersions[0]?.attemptNumber, 1);
      assert.equal(promotedDetail.workerVersions[0]?.workspaceId, 'workspace_promoted');
      assert.equal(promotedDetail.promotions[0]?.ticketId, seeded.promotedId);
      assert.equal(promotedDetail.promotions[0]?.attemptNumber, 1);
      assert.equal(promotedDetail.promotions[0]?.workerVersionStatus, 'active');
      assert.equal(promotedDetail.promotions[0]?.verificationSummary, 'build and tests passed');

      const timeline = await fetchJson(`${url}/api/tickets/${seeded.promotedId}/timeline`, 'viewer-token') as {
        metadata: {
          schemaVersion: string;
          revision: string;
          windows: { recentTickets: number; recentEvents: number };
        };
        ticket: { id: string; status: string };
        entries: Array<{ at: string; source: string; detail: string }>;
      };
      assert.equal(timeline.metadata.schemaVersion, 'ticket-timeline.v1');
      assert.ok(timeline.metadata.revision.length > 0);
      assert.equal(timeline.metadata.windows.recentTickets, 1);
      assert.equal(timeline.ticket.id, seeded.promotedId);
      assert.ok(timeline.entries.length > 0);
      assert.ok(timeline.entries.some((entry) => entry.source === 'event.promotion.completed'));
      assert.ok(timeline.entries.some((entry) => entry.source === 'promotion.updated'));

      const evidence = await fetchJson(`${url}/api/tickets/${seeded.awaitingApprovalId}/evidence`, 'viewer-token') as {
        metadata: {
          schemaVersion: string;
          revision: string;
          windows: { recentTickets: number; recentEvents: number };
        };
        ticket: { id: string; status: string };
        evidence: {
          currentPatch?: string;
          artifacts: Array<{ raw: string }>;
          policySnapshots: unknown[];
          patchDeltas: unknown[];
          sideEffects: unknown[];
        };
      };
      assert.equal(evidence.metadata.schemaVersion, 'ticket-evidence.v1');
      assert.ok(evidence.metadata.revision.length > 0);
      assert.equal(evidence.metadata.windows.recentTickets, 1);
      assert.equal(evidence.ticket.id, seeded.awaitingApprovalId);
      assert.match(evidence.evidence.currentPatch ?? '', /diff --git/);
      assert.equal(evidence.evidence.policySnapshots.length, 1);
      assert.equal(evidence.evidence.patchDeltas.length, 1);
      assert.ok(evidence.evidence.artifacts.length > 0);

      const gates = await fetchJson(`${url}/api/tickets/${seeded.awaitingApprovalId}/gates`, 'viewer-token') as {
        metadata: {
          schemaVersion: string;
          revision: string;
          windows: { recentTickets: number; recentEvents: number };
        };
        ticket: { id: string; status: string };
        completionEvidence: {
          gateStatus: string;
          mutableTargets: string[];
          observedMutations: string[];
          gateReason: string;
        };
        recoveryRecommendation: { family: string; source: string };
      };
      assert.equal(gates.metadata.schemaVersion, 'ticket-gates.v1');
      assert.ok(gates.metadata.revision.length > 0);
      assert.equal(gates.metadata.windows.recentTickets, 1);
      assert.equal(gates.ticket.id, seeded.awaitingApprovalId);
      assert.equal(gates.completionEvidence.gateStatus, 'pending evidence');
      assert.ok(gates.completionEvidence.mutableTargets.length > 0);
      assert.equal(gates.recoveryRecommendation.family, 'approval');

      const forbiddenApproval = await fetch(`${url}/api/tickets/${seeded.awaitingApprovalId}/approve`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer operator-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reviewer: 'operator@example.com', rationale: 'Should be denied' }),
      });
      assert.equal(forbiddenApproval.status, 403);
    } finally {
      await server.stop();
      await repository.stop();
    }
  });

  it('supports approval commands and server-sent event refresh notifications', async () => {
    const fixture = await createFixture();
    const repository = new TicketStoreRepository({
      tasksFile: fixture.tasksFile,
      storeFile: fixture.ticketStoreFile,
      importLegacyTaskBoardIfStoreEmpty: false,
      projectionEnabled: false,
    });
    const seeded = await seedRepository(repository, fixture.rootDir);
    const server = new UIServer({
      host: '127.0.0.1',
      port: 0,
      repository,
      baselineFile: fixture.baselineFile,
      authTokens: [
        { role: 'viewer', token: 'viewer-token', label: 'Viewer' },
        { role: 'operator', token: 'operator-token', label: 'Operator' },
        { role: 'approver', token: 'approver-token', label: 'Approver' },
      ],
      sseIntervalMs: 50,
    });
    const { url } = await server.start();

    try {
      const streamResponse = await fetch(`${url}/api/stream?token=viewer-token`, {
        headers: { Accept: 'text/event-stream' },
      });
      assert.equal(streamResponse.status, 200);
      assert.match(streamResponse.headers.get('content-type') ?? '', /text\/event-stream/);
      const reader = streamResponse.body?.getReader();
      assert.ok(reader, 'expected SSE response body reader');
      const firstChunk = await readSseChunk(reader);
      assert.match(firstChunk, /event: ready/);

      await fetchJson(`${url}/api/tickets/${seeded.awaitingApprovalId}/approve`, 'approver-token', {
        method: 'POST',
        body: JSON.stringify({ reviewer: 'approver@example.com', rationale: 'Approved from the operator console' }),
      });
      await fetchJson(`${url}/api/tickets/${seeded.awaitingApprovalId}/resume`, 'approver-token', {
        method: 'POST',
      });
      await fetchJson(`${url}/api/tickets/${seeded.blockedId}/retry`, 'operator-token', {
        method: 'POST',
        body: JSON.stringify({ amendedDescription: 'Retry a blocked runtime with a narrower verification step' }),
      });

      const ticketAfterResume = await fetchJson(`${url}/api/tickets/${seeded.awaitingApprovalId}`, 'viewer-token') as {
        ticket: { status: string; approval?: { status: string } };
      };
      assert.equal(ticketAfterResume.ticket.status, 'pending');
      assert.equal(ticketAfterResume.ticket.approval?.status, 'approved');

      const retriedTicket = await fetchJson(`${url}/api/tickets/${seeded.blockedId}`, 'viewer-token') as {
        ticket: { status: string; description: string };
      };
      assert.equal(retriedTicket.ticket.status, 'pending');
      assert.equal(retriedTicket.ticket.description, 'Retry a blocked runtime with a narrower verification step');

      const chunkAfterCommands = await readSseChunk(reader);
      assert.match(chunkAfterCommands, /event: refresh/);
    } finally {
      await server.stop();
      await repository.stop();
    }
  });
});
