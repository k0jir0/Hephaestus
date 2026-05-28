import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { HephaestusRuntime } from '../src/runtime.js';
import type { PendingTaskSideEffect } from '../src/repositories.js';
import type { AIResponse, Task, TaskPlan } from '../src/types.js';

function makeTask(description: string, id = 'task_demo'): Task {
  return {
    id,
    description,
    status: 'pending',
    createdAt: new Date(),
  };
}

function makePlan(summary: string): TaskPlan {
  return {
    summary,
    intendedFiles: [],
    commands: [],
    verification: ['Review the generated plan'],
    risks: [],
  };
}

describe('HephaestusRuntime', () => {
  it('keeps a task in queue when admission is rejected', async () => {
    const task = makeTask('Ship demo');
    const calls = {
      markTaskInProgress: 0,
      markTaskCompleted: 0,
      blockers: [] as string[],
    };

    const runtime = new HephaestusRuntime({
      memory: {
        async initialize() {},
        async updateStatus() {},
        async recordTaskCompletion() {},
        async recordBlocker(_blocker, resolution) {
          calls.blockers.push(resolution || '');
        },
        async addToTaskHistory() {},
        async addSessionSummary() {},
      },
      watcher: {
        async start() {},
        async stop() {},
        async getPendingTasks() {
          return [task];
        },
        async markTaskInProgress() {
          calls.markTaskInProgress++;
        },
        async markTaskCompleted() {
          calls.markTaskCompleted++;
        },
      },
      executor: {
        async executeTask(): Promise<AIResponse> {
          throw new Error('executeTask should not be called when admission is rejected');
        },
        async checkHealth() {
          return { available: true, message: 'ok' };
        },
      },
      safety: {
        async shouldContinue() {
          return { allowed: false, reason: 'Daily budget exceeded' };
        },
        recordSuccess() {},
        recordError() {},
        recordTaskCompletion() {},
        recordTokenUsage() {},
        shouldAutoCommit() {
          return false;
        },
        async performAutoCommit() {
          return false;
        },
        getStatusSummary() {
          return 'ok';
        },
        resetDailyCounters() {},
      },
      preflightRunner: async () => ({ ok: true, issues: [] }),
      contextProvider: async () => 'README excerpt',
    });

    await runtime.run({ runOnce: true });

    assert.equal(calls.markTaskInProgress, 0);
    assert.equal(calls.markTaskCompleted, 0);
    assert.equal(calls.blockers.length, 1);
    assert.match(calls.blockers[0] || '', /^Daily budget exceeded \[admission_[a-z0-9]+\]$/i);
  });

  it('records a successful structured plan during single-pass mode', async () => {
    const task = makeTask('Plan the runtime');
    const calls = {
      markTaskInProgress: 0,
      markTaskCompleted: 0,
      markTaskBlocked: 0,
      completions: [] as string[],
      history: [] as string[],
      summaries: [] as string[],
    };

    const runtime = new HephaestusRuntime({
      memory: {
        async initialize() {},
        async updateStatus() {},
        async recordTaskCompletion(_task, result) {
          calls.completions.push(result);
        },
        async recordBlocker() {},
        async addToTaskHistory(_task, result) {
          calls.history.push(result);
        },
        async addSessionSummary(summary) {
          calls.summaries.push(summary);
        },
      },
      watcher: {
        async start() {},
        async stop() {},
        async getPendingTasks() {
          return [task];
        },
        async markTaskInProgress() {
          calls.markTaskInProgress++;
        },
        async markTaskCompleted() {
          calls.markTaskCompleted++;
        },
        async markTaskBlocked() {
          calls.markTaskBlocked++;
        },
      },
      executor: {
        async executeTask() {
          return {
            success: true,
            content: 'Plan the runtime service.',
            rawContent: '{"summary":"Plan the runtime service."}',
            plan: makePlan('Plan the runtime service.'),
          } satisfies AIResponse;
        },
        async checkHealth() {
          return { available: true, message: 'ok' };
        },
      },
      safety: {
        async shouldContinue() {
          return { allowed: true };
        },
        recordSuccess() {},
        recordError() {},
        recordTaskCompletion() {},
        recordTokenUsage() {},
        shouldAutoCommit() {
          return false;
        },
        async performAutoCommit() {
          return false;
        },
        getStatusSummary() {
          return 'ok';
        },
        resetDailyCounters() {},
      },
      preflightRunner: async () => ({ ok: true, issues: [] }),
      contextProvider: async () => 'README excerpt',
    });

    await runtime.run({ runOnce: true });

    assert.equal(calls.markTaskInProgress, 1);
    assert.equal(calls.markTaskCompleted, 1);
    assert.equal(calls.markTaskBlocked, 0);
    assert.equal(calls.history[0], 'Plan ready');
    assert.match(calls.completions[0] || '', /Planned files: 0/);
    assert.ok(calls.summaries.includes('Planned: Plan the runtime'));
  });

  it('moves failed in-progress tasks into blocked instead of leaving them stranded', async () => {
    const task = makeTask('Ship demo');
    const calls = {
      markTaskInProgress: 0,
      markTaskCompleted: 0,
      markTaskBlocked: 0,
      blockers: [] as string[],
      summaries: [] as string[],
    };

    const runtime = new HephaestusRuntime({
      memory: {
        async initialize() {},
        async updateStatus() {},
        async recordTaskCompletion() {},
        async recordBlocker(_blocker, resolution) {
          calls.blockers.push(resolution || '');
        },
        async addToTaskHistory() {},
        async addSessionSummary(summary) {
          calls.summaries.push(summary);
        },
      },
      watcher: {
        async start() {},
        async stop() {},
        async getPendingTasks() {
          return [task];
        },
        async markTaskInProgress() {
          calls.markTaskInProgress++;
        },
        async markTaskCompleted() {
          calls.markTaskCompleted++;
        },
        async markTaskBlocked() {
          calls.markTaskBlocked++;
        },
      },
      executor: {
        async executeTask(): Promise<AIResponse> {
          return {
            success: false,
            content: 'Structured plan validation failed',
          };
        },
        async checkHealth() {
          return { available: true, message: 'ok' };
        },
      },
      safety: {
        async shouldContinue() {
          return { allowed: true };
        },
        recordSuccess() {},
        recordError() {},
        recordTaskCompletion() {},
        recordTokenUsage() {},
        shouldAutoCommit() {
          return false;
        },
        async performAutoCommit() {
          return false;
        },
        getStatusSummary() {
          return 'ok';
        },
        resetDailyCounters() {},
      },
      preflightRunner: async () => ({ ok: true, issues: [] }),
      contextProvider: async () => 'README excerpt',
    });

    await runtime.run({ runOnce: true });

    assert.equal(calls.markTaskInProgress, 1);
    assert.equal(calls.markTaskCompleted, 0);
    assert.equal(calls.markTaskBlocked, 1);
    assert.deepEqual(calls.blockers, ['Structured plan validation failed']);
    assert.ok(calls.summaries.includes('Blocked: Ship demo'));
  });

  it('continues single-pass processing after one task is rejected by admission', async () => {
    const rejectedTask = makeTask('Wait for budget reset', 'task_rejected');
    const runnableTask = makeTask('Plan the runtime', 'task_runnable');
    let rejected = true;
    const calls = {
      executed: [] as string[],
      markTaskInProgress: [] as string[],
      markTaskCompleted: [] as string[],
      blockers: [] as string[],
    };

    const runtime = new HephaestusRuntime({
      memory: {
        async initialize() {},
        async updateStatus() {},
        async recordTaskCompletion() {},
        async recordBlocker(_blocker, resolution) {
          calls.blockers.push(resolution || '');
        },
        async addToTaskHistory() {},
        async addSessionSummary() {},
      },
      watcher: {
        async start() {},
        async stop() {},
        async getPendingTasks() {
          return [rejectedTask, runnableTask];
        },
        async markTaskInProgress(task) {
          calls.markTaskInProgress.push(task.id);
        },
        async markTaskCompleted(task) {
          calls.markTaskCompleted.push(task.id);
        },
        async markTaskBlocked() {},
      },
      executor: {
        async executeTask(task) {
          calls.executed.push(task.id);
          return {
            success: true,
            content: 'Plan the runtime service.',
            plan: makePlan('Plan the runtime service.'),
          } satisfies AIResponse;
        },
        async checkHealth() {
          return { available: true, message: 'ok' };
        },
      },
      safety: {
        async shouldContinue() {
          if (rejected) {
            rejected = false;
            return { allowed: false, reason: 'Daily budget exceeded' };
          }

          return { allowed: true };
        },
        recordSuccess() {},
        recordError() {},
        recordTaskCompletion() {},
        recordTokenUsage() {},
        shouldAutoCommit() {
          return false;
        },
        async performAutoCommit() {
          return false;
        },
        getStatusSummary() {
          return 'ok';
        },
        resetDailyCounters() {},
      },
      preflightRunner: async () => ({ ok: true, issues: [] }),
      contextProvider: async () => 'README excerpt',
    });

    await runtime.run({ runOnce: true });

    assert.deepEqual(calls.executed, ['task_runnable']);
    assert.deepEqual(calls.markTaskInProgress, ['task_runnable']);
    assert.deepEqual(calls.markTaskCompleted, ['task_runnable']);
    assert.equal(calls.blockers.length, 1);
    assert.match(calls.blockers[0] || '', /^Daily budget exceeded \[admission_[a-z0-9]+\]$/i);
  });

  it('pauses execution when startup preflight reports the backend unavailable', async () => {
    const task = makeTask('Plan the runtime');
    const calls = {
      executed: 0,
      markTaskInProgress: 0,
      statuses: [] as string[],
      summaries: [] as string[],
    };

    const runtime = new HephaestusRuntime({
      memory: {
        async initialize() {},
        async updateStatus(status) {
          calls.statuses.push(status);
        },
        async recordTaskCompletion() {},
        async recordBlocker() {},
        async addToTaskHistory() {},
        async addSessionSummary(summary) {
          calls.summaries.push(summary);
        },
      },
      watcher: {
        async start() {
          throw new Error('watcher should not start while execution is paused');
        },
        async stop() {},
        async getPendingTasks() {
          return [task];
        },
        async markTaskInProgress() {
          calls.markTaskInProgress++;
        },
        async markTaskCompleted() {},
        async markTaskBlocked() {},
      },
      executor: {
        async executeTask(): Promise<AIResponse> {
          calls.executed++;
          throw new Error('executeTask should not be called while paused');
        },
        async checkHealth() {
          return { available: false, message: 'Ollama is not running' };
        },
      },
      safety: {
        async shouldContinue() {
          return { allowed: true };
        },
        recordSuccess() {},
        recordError() {},
        recordTaskCompletion() {},
        recordTokenUsage() {},
        shouldAutoCommit() {
          return false;
        },
        async performAutoCommit() {
          return false;
        },
        getStatusSummary() {
          return 'ok';
        },
        resetDailyCounters() {},
      },
      preflightRunner: async () => ({
        ok: true,
        issues: [
          {
            severity: 'warning',
            code: 'backend-unavailable',
            message: 'Ollama is not running',
          },
        ],
      }),
      contextProvider: async () => 'README excerpt',
    });

    await runtime.run({ runOnce: true });

    assert.equal(calls.executed, 0);
    assert.equal(calls.markTaskInProgress, 0);
    assert.ok(calls.statuses.includes('Paused'));
    assert.ok(calls.summaries.includes('Paused: Ollama is not running'));
  });

  it('keeps a completed task completed when non-durable memory side effects fail', async () => {
    const task = makeTask('Plan the runtime');
    const calls = {
      markTaskCompleted: 0,
      markTaskBlocked: 0,
    };

    const runtime = new HephaestusRuntime({
      memory: {
        async initialize() {},
        async updateStatus() {},
        async recordTaskCompletion() {
          throw new Error('disk full');
        },
        async recordBlocker() {},
        async addToTaskHistory() {},
        async addSessionSummary() {},
      },
      watcher: {
        async start() {},
        async stop() {},
        async getPendingTasks() {
          return [task];
        },
        async markTaskInProgress() {},
        async markTaskCompleted() {
          calls.markTaskCompleted++;
        },
        async markTaskBlocked() {
          calls.markTaskBlocked++;
        },
      },
      executor: {
        async executeTask() {
          return {
            success: true,
            content: 'Plan the runtime service.',
            plan: makePlan('Plan the runtime service.'),
          } satisfies AIResponse;
        },
        async checkHealth() {
          return { available: true, message: 'ok' };
        },
      },
      safety: {
        async shouldContinue() {
          return { allowed: true };
        },
        recordSuccess() {},
        recordError() {},
        recordTaskCompletion() {},
        recordTokenUsage() {},
        shouldAutoCommit() {
          return false;
        },
        async performAutoCommit() {
          return false;
        },
        getStatusSummary() {
          return 'ok';
        },
        resetDailyCounters() {},
      },
      preflightRunner: async () => ({ ok: true, issues: [] }),
      contextProvider: async () => 'README excerpt',
    });

    await runtime.run({ runOnce: true });

    assert.equal(calls.markTaskCompleted, 1);
    assert.equal(calls.markTaskBlocked, 0);
  });

  it('persists completion side effects when the task repository exposes a durable outbox', async () => {
    const task = makeTask('Plan the runtime');
    const calls = {
      enqueued: [] as PendingTaskSideEffect[],
      processed: [] as string[],
      failed: [] as string[],
    };

    const runtime = new HephaestusRuntime({
      memory: {
        async initialize() {},
        async updateStatus() {},
        async recordTaskCompletion() {},
        async recordBlocker() {},
        async addToTaskHistory() {},
        async addSessionSummary() {},
      },
      tasks: {
        async start() {},
        async stop() {},
        async getPendingTasks() {
          return [task];
        },
        async markTaskInProgress() {},
        async markTaskCompleted() {},
        async markTaskBlocked() {},
        async enqueueTaskSideEffects(_ticketId, sideEffects) {
          calls.enqueued.push(...sideEffects);
          return sideEffects.map((sideEffect, index) => ({
            id: `effect_${index}`,
            ticketId: task.id,
            type: sideEffect.type,
            payload: sideEffect.payload,
            status: 'pending' as const,
            idempotencyKey: sideEffect.idempotencyKey,
            correlationId: sideEffect.correlationId,
            createdAt: new Date(),
          }));
        },
        async markTaskSideEffectProcessed(id) {
          calls.processed.push(id);
        },
        async markTaskSideEffectFailed(id) {
          calls.failed.push(id);
        },
        async listTaskSideEffects() {
          return [];
        },
      },
      executor: {
        async executeTask() {
          return {
            success: true,
            content: 'Plan the runtime service.',
            plan: makePlan('Plan the runtime service.'),
          } satisfies AIResponse;
        },
        async checkHealth() {
          return { available: true, message: 'ok' };
        },
      },
      safety: {
        async shouldContinue() {
          return { allowed: true };
        },
        recordSuccess() {},
        recordError() {},
        recordTaskCompletion() {},
        recordTokenUsage() {},
        shouldAutoCommit() {
          return false;
        },
        async performAutoCommit() {
          return false;
        },
        getStatusSummary() {
          return 'ok';
        },
        resetDailyCounters() {},
      },
      preflightRunner: async () => ({ ok: true, issues: [] }),
      contextProvider: async () => 'README excerpt',
    });

    await runtime.run({ runOnce: true });

    assert.deepEqual(
      calls.enqueued.map((sideEffect) => sideEffect.type),
      [
        'memory.record-task-completion',
        'memory.add-task-history',
        'memory.add-session-summary',
      ]
    );
    assert.deepEqual(calls.processed, ['effect_0', 'effect_1', 'effect_2']);
    assert.deepEqual(calls.failed, []);
  });

  it('executes inspect and verification plan steps through the tool runtime and persists artifacts', async () => {
    const task = makeTask('Plan the runtime');
    const calls = {
      tools: [] as Array<{ tool: string; subject: string }>,
      artifacts: [] as string[],
    };

    const runtime = new HephaestusRuntime({
      memory: {
        async initialize() {},
        async updateStatus() {},
        async recordTaskCompletion() {},
        async recordBlocker() {},
        async addToTaskHistory() {},
        async addSessionSummary() {},
      },
      tasks: {
        async start() {},
        async stop() {},
        async getPendingTasks() {
          return [task];
        },
        async markTaskInProgress() {},
        async markTaskCompleted() {},
        async markTaskBlocked() {},
        async appendTaskAttemptArtifacts(_ticketId, artifacts) {
          calls.artifacts.push(...artifacts);
        },
      },
      toolRuntime: {
        async checkReadiness() {
          return { available: true, message: 'ok' };
        },
        async execute(request) {
          calls.tools.push({ tool: request.tool, subject: request.tool === 'file.read' ? request.path : request.command });
          return {
            status: 'success',
            summary: `${request.tool} completed`,
            mutatedPaths: [],
          };
        },
      },
      executor: {
        async executeTask() {
          return {
            success: true,
            content: 'Plan the runtime service.',
            plan: {
              summary: 'Plan the runtime service.',
              intendedFiles: [
                {
                  path: 'README.md',
                  purpose: 'Inspect current project guidance',
                  changeType: 'inspect',
                },
                {
                  path: 'src/runtime.ts',
                  purpose: 'Prepare a follow-up edit',
                  changeType: 'update',
                },
              ],
              commands: [
                {
                  command: 'npm test',
                  purpose: 'Verify the runtime plan',
                },
              ],
              verification: ['Review the generated plan'],
              risks: [],
            },
          } satisfies AIResponse;
        },
        async checkHealth() {
          return { available: true, message: 'ok' };
        },
      },
      safety: {
        async shouldContinue() {
          return { allowed: true };
        },
        recordSuccess() {},
        recordError() {},
        recordTaskCompletion() {},
        recordTokenUsage() {},
        shouldAutoCommit() {
          return false;
        },
        async performAutoCommit() {
          return false;
        },
        getStatusSummary() {
          return 'ok';
        },
        resetDailyCounters() {},
      },
      preflightRunner: async () => ({ ok: true, issues: [] }),
      contextProvider: async () => 'README excerpt',
    });

    await runtime.run({ runOnce: true });

    assert.deepEqual(calls.tools, [
      { tool: 'file.read', subject: 'README.md' },
      { tool: 'command.run', subject: 'npm' },
    ]);
    assert.equal(calls.artifacts.length, 4);
    assert.match(calls.artifacts[0] || '', /file\.read README\.md -> success/);
    assert.match(calls.artifacts[1] || '', /deferred-mutation update src\/runtime\.ts/);
    assert.match(calls.artifacts[2] || '', /command\.run npm test -> success/);
    assert.match(calls.artifacts[3] || '', /backend\.ollama model=/);
  });

  it('executes governed repo.search tool calls through the bounded tool runtime', async () => {
    const task = makeTask('Search the repository');
    const calls = {
      tools: [] as Array<{ tool: string; subject: string }>,
      artifacts: [] as string[],
      completed: 0,
      blocked: 0,
    };

    const runtime = new HephaestusRuntime({
      memory: {
        async initialize() {},
        async updateStatus() {},
        async recordTaskCompletion() {},
        async recordBlocker() {},
        async addToTaskHistory() {},
        async addSessionSummary() {},
      },
      tasks: {
        async start() {},
        async stop() {},
        async getPendingTasks() {
          return [task];
        },
        async markTaskInProgress() {},
        async markTaskCompleted() {
          calls.completed += 1;
        },
        async markTaskBlocked() {
          calls.blocked += 1;
        },
        async appendTaskAttemptArtifacts(_ticketId, artifacts) {
          calls.artifacts.push(...artifacts);
        },
      },
      toolRuntime: {
        async checkReadiness() {
          return { available: true, message: 'ok' };
        },
        async execute(request) {
          calls.tools.push({
            tool: request.tool,
            subject: request.tool === 'repo.search' ? request.query : '',
          });
          return {
            status: 'success',
            summary: `${request.tool} completed`,
            mutatedPaths: [],
          };
        },
      },
      executor: {
        async executeTask() {
          return {
            success: true,
            content: 'Search the repository.',
            plan: {
              summary: 'Search the repository.',
              intendedFiles: [
                {
                  path: 'src/runtime.ts',
                  purpose: 'Inspect the runtime entrypoint',
                  changeType: 'inspect',
                },
              ],
              commands: [],
              verification: ['Review the matched search results'],
              risks: [],
            },
            toolCalls: [
              {
                name: 'repo.search',
                arguments: {
                  query: 'updateStatus',
                  maxResults: 5,
                },
              },
            ],
          } satisfies AIResponse;
        },
        async checkHealth() {
          return { available: true, message: 'ok' };
        },
      },
      safety: {
        async shouldContinue() {
          return { allowed: true };
        },
        recordSuccess() {},
        recordError() {},
        recordTaskCompletion() {},
        recordTokenUsage() {},
        shouldAutoCommit() {
          return false;
        },
        async performAutoCommit() {
          return false;
        },
        getStatusSummary() {
          return 'ok';
        },
        resetDailyCounters() {},
      },
      preflightRunner: async () => ({ ok: true, issues: [] }),
      contextProvider: async () => 'README excerpt',
    });

    await runtime.run({ runOnce: true });

    assert.deepEqual(calls.tools, [
      { tool: 'file.read', subject: '' },
      { tool: 'repo.search', subject: 'updateStatus' },
    ]);
    assert.equal(calls.completed, 1);
    assert.equal(calls.blocked, 0);
    assert.match(calls.artifacts[1] || '', /repo\.search updateStatus -> success/);
  });

  it('executes low-risk patch tool calls through dry-run and apply with persisted policy artifacts', async () => {
    const task = makeTask('Apply a safe patch');
    const calls = {
      toolRequests: [] as Array<{ tool: string; dryRun?: boolean }>,
      artifacts: [] as string[],
      markTaskCompleted: 0,
    };

    const runtime = new HephaestusRuntime({
      memory: {
        async initialize() {},
        async updateStatus() {},
        async recordTaskCompletion() {},
        async recordBlocker() {},
        async addToTaskHistory() {},
        async addSessionSummary() {},
      },
      tasks: {
        async start() {},
        async stop() {},
        async getPendingTasks() {
          return [task];
        },
        async markTaskInProgress() {},
        async markTaskAwaitingApproval() {
          assert.fail('safe patch should not require approval');
        },
        async markTaskCompleted() {
          calls.markTaskCompleted += 1;
        },
        async markTaskBlocked() {
          assert.fail('safe patch should not block the task');
        },
        async appendTaskAttemptArtifacts(_ticketId, artifacts) {
          calls.artifacts.push(...artifacts);
        },
      },
      toolRuntime: {
        getPolicySnapshot() {
          return {
            version: 'hephaestus-tool-policy/v1',
            workspaceRoot: '.',
            dryRunByDefault: false,
            maxReadBytes: 1024,
            maxOutputBytes: 1024,
            maxSearchResults: 10,
            commandTimeoutMs: 1000,
            commandAllowlist: ['npm test'],
            protectedPathPrefixes: ['.git'],
            patchRiskThresholds: {
              maxSafeTouchedPaths: 1,
              maxSafeChangedLines: 20,
            },
            generatedAt: new Date('2026-05-27T00:00:00.000Z'),
            signature: 'policy1234abcd5678',
          };
        },
        async checkReadiness() {
          return { available: true, message: 'ok' };
        },
        async execute(request) {
          calls.toolRequests.push({ tool: request.tool, dryRun: 'dryRun' in request ? request.dryRun : undefined });
          if (request.tool === 'patch.apply') {
            return request.dryRun
              ? {
                  id: 'tool_dry_run',
                  tool: 'patch.apply',
                  status: 'dry_run' as const,
                  startedAt: new Date(),
                  endedAt: new Date(),
                  summary: 'Patch validated for 1 file(s).',
                  reasonCode: 'dry-run-only',
                  mutatedPaths: ['README.md'],
                }
              : {
                  id: 'tool_apply',
                  tool: 'patch.apply',
                  status: 'success' as const,
                  startedAt: new Date(),
                  endedAt: new Date(),
                  summary: 'Patch applied to 1 file(s).',
                  mutatedPaths: ['README.md'],
                };
          }

          return {
            id: 'tool_other',
            tool: request.tool,
            status: 'success' as const,
            startedAt: new Date(),
            endedAt: new Date(),
            summary: `${request.tool} completed`,
            mutatedPaths: [],
          };
        },
      },
      executor: {
        async executeTask() {
          return {
            success: true,
            content: 'Apply a safe patch.',
            plan: {
              summary: 'Apply a safe patch.',
              intendedFiles: [
                {
                  path: 'README.md',
                  purpose: 'Update documentation safely',
                  changeType: 'update',
                },
              ],
              commands: [],
              verification: ['Review the applied patch'],
              risks: [],
            },
            toolCalls: [
              {
                name: 'patch.apply',
                arguments: {
                  patch: [
                    'diff --git a/README.md b/README.md',
                    '--- a/README.md',
                    '+++ b/README.md',
                    '@@ -1 +1 @@',
                    '-old heading',
                    '+new heading',
                    '',
                  ].join('\n'),
                },
              },
            ],
          } satisfies AIResponse;
        },
        async checkHealth() {
          return { available: true, message: 'ok' };
        },
      },
      safety: {
        async shouldContinue() {
          return { allowed: true };
        },
        recordSuccess() {},
        recordError() {},
        recordTaskCompletion() {},
        recordTokenUsage() {},
        shouldAutoCommit() {
          return false;
        },
        async performAutoCommit() {
          return false;
        },
        getStatusSummary() {
          return 'ok';
        },
        resetDailyCounters() {},
      },
      preflightRunner: async () => ({ ok: true, issues: [] }),
      contextProvider: async () => 'README excerpt',
    });

    await runtime.run({ runOnce: true });

    assert.deepEqual(calls.toolRequests, [
      { tool: 'patch.apply', dryRun: true },
      { tool: 'patch.apply', dryRun: undefined },
    ]);
    assert.equal(calls.markTaskCompleted, 1);
    assert.ok(calls.artifacts.some((artifact) => /policy\.snapshot \[policy1234abcd5678\]/.test(artifact)));
    assert.ok(calls.artifacts.some((artifact) => /patch\.apply README\.md \[dry-run\] -> dry_run/.test(artifact)));
    assert.ok(calls.artifacts.some((artifact) => /patch\.apply README\.md \[apply\] -> success/.test(artifact)));
    assert.ok(calls.artifacts.some((artifact) => /patch\.delta README\.md: dry-run=dry_run\/dry-run-only; apply=success/.test(artifact)));
  });

  it('moves approval-required mutations into awaiting approval instead of completing the task', async () => {
    const task = makeTask('Apply a broad patch');
    const calls = {
      awaitingApproval: 0,
      completed: 0,
      histories: [] as string[],
      summaries: [] as string[],
      statuses: [] as string[],
      artifacts: [] as string[],
    };

    const runtime = new HephaestusRuntime({
      memory: {
        async initialize() {},
        async updateStatus(status) {
          calls.statuses.push(status);
        },
        async recordTaskCompletion() {},
        async recordBlocker() {},
        async addToTaskHistory(_task, result) {
          calls.histories.push(result);
        },
        async addSessionSummary(summary) {
          calls.summaries.push(summary);
        },
      },
      tasks: {
        async start() {},
        async stop() {},
        async getPendingTasks() {
          return [task];
        },
        async markTaskInProgress() {},
        async markTaskAwaitingApproval() {
          calls.awaitingApproval += 1;
        },
        async markTaskCompleted() {
          calls.completed += 1;
        },
        async markTaskBlocked() {
          assert.fail('approval-required patch should not be treated as blocked');
        },
        async appendTaskAttemptArtifacts(_ticketId, artifacts) {
          calls.artifacts.push(...artifacts);
        },
      },
      toolRuntime: {
        async checkReadiness() {
          return { available: true, message: 'ok' };
        },
        getPolicySnapshot() {
          return {
            version: 'hephaestus-tool-policy/v1',
            workspaceRoot: '.',
            dryRunByDefault: false,
            maxReadBytes: 1024,
            maxOutputBytes: 1024,
            maxSearchResults: 10,
            commandTimeoutMs: 1000,
            commandAllowlist: ['npm test'],
            protectedPathPrefixes: ['.git'],
            patchRiskThresholds: {
              maxSafeTouchedPaths: 1,
              maxSafeChangedLines: 20,
            },
            generatedAt: new Date('2026-05-27T00:00:00.000Z'),
            signature: 'policy1234abcd5678',
          };
        },
        async execute(request) {
          if (request.tool === 'patch.apply') {
            return request.dryRun
              ? {
                  id: 'tool_dry_run',
                  tool: 'patch.apply',
                  status: 'dry_run' as const,
                  startedAt: new Date(),
                  endedAt: new Date(),
                  summary: 'Patch validated for 2 file(s). Approval will be required to apply: patch touches 2 files',
                  reasonCode: 'dry-run-only',
                  mutatedPaths: ['README.md', 'src/runtime.ts'],
                }
              : {
                  id: 'tool_apply',
                  tool: 'patch.apply',
                  status: 'denied' as const,
                  startedAt: new Date(),
                  endedAt: new Date(),
                  summary: 'Patch requires approval before apply: patch touches 2 files',
                  reasonCode: 'approval-required',
                  mutatedPaths: ['README.md', 'src/runtime.ts'],
                };
          }

          return {
            id: 'tool_other',
            tool: request.tool,
            status: 'success' as const,
            startedAt: new Date(),
            endedAt: new Date(),
            summary: `${request.tool} completed`,
            mutatedPaths: [],
          };
        },
      },
      executor: {
        async executeTask() {
          return {
            success: true,
            content: 'Apply a broad patch.',
            plan: {
              summary: 'Apply a broad patch.',
              intendedFiles: [
                {
                  path: 'README.md',
                  purpose: 'Update documentation',
                  changeType: 'update',
                },
                {
                  path: 'src/runtime.ts',
                  purpose: 'Update runtime behavior',
                  changeType: 'update',
                },
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
          } satisfies AIResponse;
        },
        async checkHealth() {
          return { available: true, message: 'ok' };
        },
      },
      safety: {
        async shouldContinue() {
          return { allowed: true };
        },
        recordSuccess() {},
        recordError() {},
        recordTaskCompletion() {},
        recordTokenUsage() {},
        shouldAutoCommit() {
          return false;
        },
        async performAutoCommit() {
          return false;
        },
        getStatusSummary() {
          return 'ok';
        },
        resetDailyCounters() {},
      },
      preflightRunner: async () => ({ ok: true, issues: [] }),
      contextProvider: async () => 'README excerpt',
    });

    await runtime.run({ runOnce: true });

    assert.equal(calls.awaitingApproval, 1);
    assert.equal(calls.completed, 0);
    assert.ok(calls.histories.some((entry) => /Awaiting approval: Patch requires approval/.test(entry)));
    assert.ok(calls.summaries.includes('Awaiting approval: Apply a broad patch'));
    assert.ok(calls.statuses.includes('Awaiting Approval'));
    assert.ok(calls.artifacts.some((artifact) => /patch\.delta README\.md, src\/runtime\.ts: dry-run=dry_run\/dry-run-only; apply=denied\/approval-required/.test(artifact)));
  });

  it('resumes approved patch tool calls without replanning and forwards the approval token', async () => {
    const task: Task = {
      ...makeTask('Resume an approved patch'),
      plan: {
        summary: 'Apply the approved patch.',
        intendedFiles: [
          {
            path: 'README.md',
            purpose: 'Update documentation',
            changeType: 'update',
          },
        ],
        commands: [],
        verification: ['Review the approved patch'],
        risks: ['Requires approved mutation replay'],
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
        requestId: 'approval_req_resume',
        status: 'approved',
        requestedAt: new Date('2026-05-27T00:00:00.000Z'),
        requestedReason: 'Patch requires approval before apply: patch touches 1 file',
        decisionAt: new Date('2026-05-27T00:05:00.000Z'),
        reviewer: 'operator@example.com',
        rationale: 'Approved for replay.',
        approvalId: 'approval_token_demo',
        touchedPaths: ['README.md'],
      },
    };

    const calls = {
      completed: 0,
      blocked: 0,
      awaitingApproval: 0,
      toolRequests: [] as Array<{ tool: string; dryRun?: boolean; approvalId?: string }>,
    };

    const runtime = new HephaestusRuntime({
      memory: {
        async initialize() {},
        async updateStatus() {},
        async recordTaskCompletion() {},
        async recordBlocker() {},
        async addToTaskHistory() {},
        async addSessionSummary() {},
      },
      tasks: {
        async start() {},
        async stop() {},
        async getPendingTasks() {
          return [task];
        },
        async markTaskInProgress() {},
        async markTaskAwaitingApproval() {
          calls.awaitingApproval += 1;
        },
        async markTaskCompleted() {
          calls.completed += 1;
        },
        async markTaskBlocked() {
          calls.blocked += 1;
        },
        async appendTaskAttemptArtifacts() {},
      },
      executor: {
        async executeTask(): Promise<AIResponse> {
          assert.fail('approved resume should not call the planner again');
        },
        async checkHealth() {
          return { available: true, message: 'ok' };
        },
      },
      toolRuntime: {
        async checkReadiness() {
          return { available: true, message: 'ok' };
        },
        getPolicySnapshot() {
          return {
            version: 'hephaestus-tool-policy/v1',
            workspaceRoot: '.',
            dryRunByDefault: false,
            maxReadBytes: 1024,
            maxOutputBytes: 1024,
            maxSearchResults: 10,
            commandTimeoutMs: 1000,
            commandAllowlist: ['npm test'],
            protectedPathPrefixes: ['.git'],
            patchRiskThresholds: {
              maxSafeTouchedPaths: 1,
              maxSafeChangedLines: 20,
            },
            generatedAt: new Date('2026-05-27T00:00:00.000Z'),
            signature: 'policy1234abcd5678',
          };
        },
        async execute(request) {
          if (request.tool !== 'patch.apply') {
            assert.fail(`unexpected resumed tool request: ${request.tool}`);
          }

          calls.toolRequests.push({
            tool: request.tool,
            dryRun: request.dryRun,
            approvalId: request.approvalId,
          });

          return request.dryRun
            ? {
                id: 'tool_dry_run',
                tool: 'patch.apply',
                status: 'dry_run' as const,
                startedAt: new Date(),
                endedAt: new Date(),
                summary: 'Patch validated for 1 file(s).',
                reasonCode: 'dry-run-only',
                mutatedPaths: ['README.md'],
              }
            : {
                id: 'tool_apply',
                tool: 'patch.apply',
                status: 'success' as const,
                startedAt: new Date(),
                endedAt: new Date(),
                summary: 'Patch applied to 1 file(s).',
                mutatedPaths: ['README.md'],
              };
        },
      },
      safety: {
        async shouldContinue() {
          return { allowed: true };
        },
        recordSuccess() {},
        recordError() {},
        recordTaskCompletion() {},
        recordTokenUsage() {},
        shouldAutoCommit() {
          return false;
        },
        async performAutoCommit() {
          return false;
        },
        getStatusSummary() {
          return 'ok';
        },
        resetDailyCounters() {},
      },
      preflightRunner: async () => ({ ok: true, issues: [] }),
      contextProvider: async () => 'README excerpt',
    });

    await runtime.run({ runOnce: true });

    assert.equal(calls.completed, 1);
    assert.equal(calls.blocked, 0);
    assert.equal(calls.awaitingApproval, 0);
    assert.deepEqual(calls.toolRequests, [
      { tool: 'patch.apply', dryRun: true, approvalId: undefined },
      { tool: 'patch.apply', dryRun: undefined, approvalId: 'approval_token_demo' },
    ]);
  });

  it('applies safe patches through the default runtime tool layer when dry-run mode is disabled', async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'Hephaestus-runtime-'));

    try {
      await fs.writeFile(path.join(workspaceRoot, 'README.md'), 'old heading\n', 'utf-8');
      const task = makeTask('Apply a real patch');
      const calls = {
        completed: 0,
        blocked: 0,
      };

      const runtime = new HephaestusRuntime({
        config: {
          aiBackend: 'ollama',
          aiModel: 'llama3',
          safety: {
            dailyTokenBudget: 10,
            maxIterations: 50,
            errorThreshold: 5,
            autoCommitInterval: 0,
          },
          targetProject: workspaceRoot,
          checkInterval: 60_000,
          selfAuditOnStartup: false,
          selfAuditMaxTickets: 5,
          toolRuntimeDryRun: false,
          baseDir: workspaceRoot,
          tasksFile: path.join(workspaceRoot, 'TASKS.md'),
          ticketStoreFile: path.join(workspaceRoot, '.hephaestus-tickets.db'),
          allowMarkdownTaskFallback: false,
          taskBoardProjectionEnabled: false,
          agentMemoryFile: path.join(workspaceRoot, 'AGENT.md'),
          progressLog: path.join(workspaceRoot, 'PROGRESS.log'),
          ollamaBaseUrl: 'http://localhost:11434',
        },
        memory: {
          async initialize() {},
          async updateStatus() {},
          async recordTaskCompletion() {},
          async recordBlocker() {},
          async addToTaskHistory() {},
          async addSessionSummary() {},
        },
        tasks: {
          async start() {},
          async stop() {},
          async getPendingTasks() {
            return [task];
          },
          async markTaskInProgress() {},
          async markTaskAwaitingApproval() {
            assert.fail('safe patch should not require approval');
          },
          async markTaskCompleted() {
            calls.completed += 1;
          },
          async markTaskBlocked() {
            calls.blocked += 1;
          },
          async appendTaskAttemptArtifacts() {},
        },
        executor: {
          async executeTask() {
            return {
              success: true,
              content: 'Apply a real patch.',
              plan: {
                summary: 'Apply a real patch.',
                intendedFiles: [
                  {
                    path: 'README.md',
                    purpose: 'Update documentation safely',
                    changeType: 'update',
                  },
                ],
                commands: [],
                verification: ['Review the applied patch'],
                risks: [],
              },
              toolCalls: [
                {
                  name: 'patch.apply',
                  arguments: {
                    patch: [
                      'diff --git a/README.md b/README.md',
                      '--- a/README.md',
                      '+++ b/README.md',
                      '@@ -1 +1 @@',
                      '-old heading',
                      '+new heading',
                      '',
                    ].join('\n'),
                  },
                },
              ],
            } satisfies AIResponse;
          },
          async checkHealth() {
            return { available: true, message: 'ok' };
          },
        },
        safety: {
          async shouldContinue() {
            return { allowed: true };
          },
          recordSuccess() {},
          recordError() {},
          recordTaskCompletion() {},
          recordTokenUsage() {},
          shouldAutoCommit() {
            return false;
          },
          async performAutoCommit() {
            return false;
          },
          getStatusSummary() {
            return 'ok';
          },
          resetDailyCounters() {},
        },
        preflightRunner: async () => ({ ok: true, issues: [] }),
        contextProvider: async () => 'README excerpt',
      });

      await runtime.run({ runOnce: true });

      assert.equal(calls.completed, 1);
      assert.equal(calls.blocked, 0);
      assert.equal(
        (await fs.readFile(path.join(workspaceRoot, 'README.md'), 'utf-8')).replace(/\r\n/g, '\n'),
        'new heading\n'
      );
    } finally {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('runs startup self-audit seeding when enabled before single-pass execution', async () => {
    const calls = {
      seeded: 0,
      stopped: 0,
    };

    const runtime = new HephaestusRuntime({
      config: {
        aiBackend: 'ollama',
        aiModel: 'llama3',
        safety: {
          dailyTokenBudget: 10,
          maxIterations: 50,
          errorThreshold: 5,
          autoCommitInterval: 0,
        },
        targetProject: process.cwd(),
        checkInterval: 60_000,
        selfAuditOnStartup: true,
        selfAuditMaxTickets: 3,
        baseDir: process.cwd(),
        tasksFile: 'TASKS.md',
        ticketStoreFile: '.hephaestus-tickets.db',
        allowMarkdownTaskFallback: false,
        taskBoardProjectionEnabled: true,
        agentMemoryFile: 'AGENT.md',
        progressLog: 'PROGRESS.log',
        ollamaBaseUrl: 'http://localhost:11434',
      },
      memory: {
        async initialize() {},
        async updateStatus() {},
        async recordTaskCompletion() {},
        async recordBlocker() {},
        async addToTaskHistory() {},
        async addSessionSummary() {},
      },
      watcher: {
        async start() {},
        async stop() {
          calls.stopped += 1;
        },
        async getPendingTasks() {
          return [];
        },
        async markTaskInProgress() {},
        async markTaskAwaitingApproval() {},
        async markTaskCompleted() {},
        async markTaskBlocked() {},
      },
      executor: {
        async executeTask(): Promise<AIResponse> {
          throw new Error('executeTask should not be called when there are no pending tasks');
        },
        async checkHealth() {
          return { available: true, message: 'ok' };
        },
      },
      safety: {
        async shouldContinue() {
          return { allowed: true };
        },
        recordSuccess() {},
        recordError() {},
        recordTaskCompletion() {},
        recordTokenUsage() {},
        shouldAutoCommit() {
          return false;
        },
        async performAutoCommit() {
          return false;
        },
        getStatusSummary() {
          return 'ok';
        },
        resetDailyCounters() {},
      },
      selfAuditSeeder: {
        async seedTickets() {
          calls.seeded += 1;
          return {
            summary: 'seeded',
            findings: [],
            created: [],
            skippedDuplicates: [],
            skippedBecauseQueueActive: false,
            rawContent: '{}',
          };
        },
      },
      preflightRunner: async () => ({ ok: true, issues: [] }),
      contextProvider: async () => 'README excerpt',
    });

    await runtime.run({ runOnce: true });

    assert.equal(calls.seeded, 1);
    assert.equal(calls.stopped, 1);
  });
});
