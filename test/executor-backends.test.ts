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
  it('streams generated content into the returned response and stream log', async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hephaestus-ollama-'));
    tempDirs.push(baseDir);

    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('{"response":"{\"summary\":\"Hello","done":false}\n'));
        controller.enqueue(encoder.encode('{"response":" world\",\"intendedFiles\":[],\"commands\":[],\"verification\":[\"Check\"],\"risks\":[]}","done":false}\n'));
        controller.enqueue(encoder.encode('{"done":true}\n'));
        controller.close();
      },
    });

    const client = createBackendClient({
      config: makeConfig(baseDir),
      fetchImpl: async () => new Response(body, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    });

    const response = await client.requestStructuredPlan('PROMPT', 'SYSTEM');

    assert.equal(response.success, true);
    assert.match(response.content, /Hello world/);

    const logContent = await fs.readFile(path.join(baseDir, 'logs', 'ollama-stream.out'), 'utf8');
    assert.match(logContent, /Hello world/);
  });
});