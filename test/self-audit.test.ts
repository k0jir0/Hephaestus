import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SelfAuditSeeder } from '../src/self-audit.js';
import type { AIResponse, TaskTicket } from '../src/types.js';

function makeTicket(description: string, status: TaskTicket['status'] = 'completed'): TaskTicket {
  return {
    id: `ticket_${description.length}`,
    description,
    status,
    createdAt: new Date(),
    updatedAt: new Date(),
    attemptCount: 0,
    sourceOrder: 1,
  };
}

describe('SelfAuditSeeder', () => {
  it('creates only new self-audit tickets from structured model output', async () => {
    const created: Array<{ id: string; description: string }> = [];
    const repository = {
      async listTickets() {
        return [makeTicket('Self-audit [high/startup]: Add a real UI health endpoint')];
      },
      async createTicket(description: string) {
        const ticket = { id: `ticket_${created.length + 1}`, status: 'pending' as const, description };
        created.push(ticket);
        return ticket;
      },
    };

    const seeder = new SelfAuditSeeder({
      config: {
        aiBackend: 'ollama',
        aiModel: 'llama3',
        safety: {
          dailyTokenBudget: 10,
          maxIterations: 50,
          errorThreshold: 5,
          autoCommitInterval: 0,
        },
        targetProject: 'C:/nonexistent-self-audit-test-fixture',
        checkInterval: 60_000,
        selfAuditOnStartup: false,
        selfAuditMaxTickets: 5,
        baseDir: 'C:/nonexistent-self-audit-test-fixture',
        tasksFile: 'C:/nonexistent-self-audit-test-fixture/TASKS.md',
        ticketStoreFile: 'C:/nonexistent-self-audit-test-fixture/.hephaestus-tickets.db',
        allowMarkdownTaskFallback: false,
        taskBoardProjectionEnabled: true,
        agentMemoryFile: 'C:/nonexistent-self-audit-test-fixture/AGENT.md',
        progressLog: 'C:/nonexistent-self-audit-test-fixture/PROGRESS.log',
        ollamaBaseUrl: 'http://localhost:11434',
      },
      repository,
      backendClient: {
        backend: 'ollama',
        async requestStructuredPlan(): Promise<AIResponse> {
          return {
            success: true,
            content: JSON.stringify({
              summary: 'Two useful follow-up items',
              tickets: [
                {
                  title: 'Add a real UI health endpoint',
                  priority: 'high',
                  area: 'startup',
                  rationale: 'Smoke tests currently hit the root page.',
                },
                {
                  title: 'Add a stop_all script that terminates daemon and UI processes from PID files',
                  priority: 'medium',
                  area: 'tooling',
                  rationale: 'The launcher currently starts processes without a paired shutdown helper.',
                },
              ],
            }),
          };
        },
        async checkHealth() {
          return { available: true, message: 'ok' };
        },
      },
      snapshotProvider: async () => 'repo snapshot',
    });

    const result = await seeder.seedTickets({ limit: 5 });

    assert.equal(result.created.length, 1);
    assert.equal(result.skippedDuplicates.length, 1);
    assert.match(
      result.created[0]?.description ?? '',
      /^Self-audit \[medium\/tooling\]: Add a stop_all script/i
    );
  });

  it('falls back to heuristic findings when model output is not actionable', async () => {
    const seeder = new SelfAuditSeeder({
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
        selfAuditOnStartup: false,
        selfAuditMaxTickets: 5,
        baseDir: process.cwd(),
        tasksFile: 'TASKS.md',
        ticketStoreFile: '.hephaestus-tickets.db',
        allowMarkdownTaskFallback: false,
        taskBoardProjectionEnabled: true,
        agentMemoryFile: 'AGENT.md',
        progressLog: 'PROGRESS.log',
        ollamaBaseUrl: 'http://localhost:11434',
      },
      repository: {
        async listTickets() {
          return [];
        },
        async createTicket(description: string) {
          return { id: `ticket_${description.length}`, status: 'pending' as const, description };
        },
      },
      backendClient: {
        backend: 'ollama',
        async requestStructuredPlan(): Promise<AIResponse> {
          return {
            success: true,
            content: '- Code: The workspace contains TypeScript source code for the Hephaestus agent.',
          };
        },
        async checkHealth() {
          return { available: true, message: 'ok' };
        },
      },
      snapshotProvider: async () => 'repo snapshot',
    });

    const result = await seeder.seedTickets({ dryRun: true, limit: 2 });

    assert.equal(result.findings.length, 2);
    assert.match(result.created[0]?.description ?? '', /^Self-audit \[high\/startup\]: Add a \/health endpoint/i);
    assert.match(result.created[1]?.description ?? '', /^Self-audit \[medium\/tooling\]: Add a stop_all script/i);
  });

  it('skips startup seeding when active tickets already exist', async () => {
    const seeder = new SelfAuditSeeder({
      repository: {
        async listTickets() {
          return [makeTicket('Existing pending work', 'pending')];
        },
        async createTicket() {
          throw new Error('createTicket should not be called when the queue is active');
        },
      },
      backendClient: {
        backend: 'ollama',
        async requestStructuredPlan(): Promise<AIResponse> {
          throw new Error('requestStructuredPlan should not run when active tickets exist');
        },
        async checkHealth() {
          return { available: true, message: 'ok' };
        },
      },
      snapshotProvider: async () => 'repo snapshot',
    });

    const result = await seeder.seedTickets({ onlyWhenQueueEmpty: true });

    assert.equal(result.skippedBecauseQueueActive, true);
    assert.equal(result.created.length, 0);
  });
});