import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AIExecutor } from '../src/executor.js';
import type { AIResponse, Task } from '../src/types.js';

function makeTask(): Task {
  return {
    id: 'task_executor',
    description: 'Inspect executor orchestration',
    status: 'pending',
    createdAt: new Date(),
  };
}

describe('AIExecutor', () => {
  it('orchestrates prompt policy, backend transport, and response parsing through injected components', async () => {
    const calls = {
      promptTask: '' as string | undefined,
      promptContext: '' as string | undefined,
      backendPrompt: '' as string | undefined,
      backendSystemPrompt: '' as string | undefined,
      parsedContent: '' as string | undefined,
      healthChecks: 0,
    };

    const executor = new AIExecutor({
      promptPolicy: {
        buildPrompt(task, context) {
          calls.promptTask = task.description;
          calls.promptContext = context;
          return 'PROMPT';
        },
        getSystemPrompt() {
          return 'SYSTEM';
        },
      },
      backendClient: {
        backend: 'ollama',
        async requestStructuredPlan(prompt, systemPrompt): Promise<AIResponse> {
          calls.backendPrompt = prompt;
          calls.backendSystemPrompt = systemPrompt;
          return {
            success: true,
            content: '{"summary":"Parsed summary","intendedFiles":[],"commands":[],"verification":["Check"],"risks":[]}',
          };
        },
        async checkHealth() {
          calls.healthChecks += 1;
          return { available: true, message: 'ok' };
        },
      },
      responseParser: {
        parse(response) {
          calls.parsedContent = response.content;
          return {
            ...response,
            content: 'Parsed summary',
          };
        },
      },
    });

    const response = await executor.executeTask(makeTask(), 'repo context');
    const health = await executor.checkHealth();

    assert.equal(response.success, true);
    assert.equal(response.content, 'Parsed summary');
    assert.equal(calls.promptTask, 'Inspect executor orchestration');
    assert.equal(calls.promptContext, 'repo context');
    assert.equal(calls.backendPrompt, 'PROMPT');
    assert.equal(calls.backendSystemPrompt, 'SYSTEM');
    assert.match(calls.parsedContent ?? '', /Parsed summary/);
    assert.equal(health.available, true);
    assert.equal(calls.healthChecks, 1);
  });
});