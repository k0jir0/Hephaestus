import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import type { Config } from '../src/config.js';
import { createBackendClient } from '../src/executor-backends.js';

const tempDirs: string[] = [];

function makeConfig(baseDir: string): Config {
  return {
    aiBackend: 'ollama',
    aiModel: 'llama3',
    safety: {
      dailyTokenBudget: 10,
      maxIterations: 50,
      errorThreshold: 5,
      autoCommitInterval: 0,
    },
    targetProject: baseDir,
    checkInterval: 60_000,
    selfAuditOnStartup: false,
    selfAuditMaxTickets: 5,
    baseDir,
    tasksFile: path.join(baseDir, 'TASKS.md'),
    ticketStoreFile: path.join(baseDir, '.hephaestus-tickets.db'),
    allowMarkdownTaskFallback: false,
    taskBoardProjectionEnabled: true,
    agentMemoryFile: path.join(baseDir, 'AGENT.md'),
    progressLog: path.join(baseDir, 'PROGRESS.log'),
    ollamaBaseUrl: 'http://localhost:11434',
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

describe('OllamaBackendClient', () => {
  it('streams chat content into the returned response and stream log', async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hephaestus-ollama-'));
    tempDirs.push(baseDir);

    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('{"message":{"content":"Hello "},"done":false}\n'));
        controller.enqueue(encoder.encode('{"message":{"content":"world"},"done":false}\n'));
        controller.enqueue(encoder.encode('{"done":true,"prompt_eval_count":12,"eval_count":2}\n'));
        controller.close();
      },
    });
    let requestedUrl = '';
    let requestedBody = '';

    const client = createBackendClient({
      config: makeConfig(baseDir),
      fetchImpl: async (input, init) => {
        requestedUrl = String(input);
        requestedBody = String(init?.body ?? '');
        return new Response(body, {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });

    const response = await client.requestStructuredPlan('PROMPT', 'SYSTEM');

    assert.equal(response.success, true);
    assert.match(response.content, /Hello world/);
    assert.equal(response.tokens?.prompt, 12);
    assert.equal(response.tokens?.completion, 2);
    assert.match(requestedUrl, /\/api\/chat$/);
    assert.match(requestedBody, /"messages"/);

    const logContent = await fs.readFile(path.join(baseDir, 'logs', 'ollama-stream.out'), 'utf8');
    assert.match(logContent, /endpoint=chat/);
    assert.match(logContent, /Hello world/);
  });

  it('falls back to generate when the chat endpoint is unavailable', async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hephaestus-ollama-'));
    tempDirs.push(baseDir);

    const encoder = new TextEncoder();
    const generateBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('{"response":"Fallback ","done":false}\n'));
        controller.enqueue(encoder.encode('{"response":"works","done":true,"prompt_eval_count":6,"eval_count":2}\n'));
        controller.close();
      },
    });
    const requestedUrls: string[] = [];

    const client = createBackendClient({
      config: makeConfig(baseDir),
      fetchImpl: async (input) => {
        requestedUrls.push(String(input));
        if (requestedUrls.length === 1) {
          return new Response('', { status: 404, statusText: 'Not Found' });
        }

        return new Response(generateBody, {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });

    const response = await client.requestStructuredPlan('PROMPT', 'SYSTEM');

    assert.equal(response.success, true);
    assert.equal(response.content, 'Fallback works');
    assert.equal(response.tokens?.prompt, 6);
    assert.equal(response.tokens?.completion, 2);
    assert.match(requestedUrls[0] ?? '', /\/api\/chat$/);
    assert.match(requestedUrls[1] ?? '', /\/api\/generate$/);

    const logContent = await fs.readFile(path.join(baseDir, 'logs', 'ollama-stream.out'), 'utf8');
    assert.match(logContent, /endpoint=generate/);
    assert.match(logContent, /Fallback works/);
  });
});
