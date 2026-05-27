import assert from 'node:assert/strict';
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
    assert.equal(calls.artifacts.length, 3);
    assert.match(calls.artifacts[0] || '', /file\.read README\.md -> success/);
    assert.match(calls.artifacts[1] || '', /deferred-mutation update src\/runtime\.ts/);
    assert.match(calls.artifacts[2] || '', /command\.run npm test -> success/);
  });
});
