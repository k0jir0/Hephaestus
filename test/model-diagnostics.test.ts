import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import type { Config } from '../src/config.js';
import {
  buildModelStatus,
  parseOllamaTagsResponse,
  readLatestModelBenchmarkSummary,
  runOllamaModelBenchmark,
  runOllamaModelSmokeTest,
} from '../src/model-diagnostics.js';

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const tempDir = tempDirs.pop();
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }
});

function makeConfig(): Config {
  return {
    aiBackend: 'ollama',
    aiModel: 'qwen3-coder:30b',
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
    tasksFile: path.join(process.cwd(), 'TASKS.md'),
    ticketStoreFile: path.join(process.cwd(), '.hephaestus-tickets.db'),
    allowMarkdownTaskFallback: false,
    taskBoardProjectionEnabled: true,
    agentMemoryFile: path.join(process.cwd(), 'AGENT.md'),
    progressLog: path.join(process.cwd(), 'PROGRESS.log'),
    ollamaBaseUrl: 'http://localhost:11434',
  };
}

describe('model diagnostics', () => {
  it('parses Ollama tag inventory into profiled installed models', () => {
    const inventory = parseOllamaTagsResponse({
      models: [
        {
          name: 'codellama:latest',
          size: 4080218932,
          modified_at: '2026-05-28T00:00:00Z',
          details: {
            family: 'llama',
            parameter_size: '7B',
            quantization_level: 'Q4_0',
          },
        },
      ],
    });

    assert.equal(inventory.available, true);
    assert.equal(inventory.models.length, 1);
    assert.equal(inventory.models[0]?.name, 'codellama:latest');
    assert.equal(inventory.models[0]?.profile.known, true);
    assert.equal(inventory.models[0]?.sizeGb, 3.8);
  });

  it('builds model status with recommendations from installed models', () => {
    const inventory = parseOllamaTagsResponse({
      models: [{ name: 'gpt-oss:20b', size: 15_000_000_000 }],
    });
    const status = buildModelStatus(makeConfig(), inventory);

    assert.equal(status.activeModel, 'qwen3-coder:30b');
    assert.equal(status.profile.known, true);
    assert.equal(status.recommendations[1]?.model, 'gpt-oss:20b');
    assert.equal(status.recommendations[1]?.installed, true);
    assert.equal(status.routingPolicy.maxLocalRetries, 2);
    assert.match(status.routingPolicy.codexHandoffSummary, /handoff/i);
  });

  it('runs a structured smoke test through the Ollama chat API', async () => {
    let requestedBody = '';
    const result = await runOllamaModelSmokeTest(makeConfig(), {
      fetchImpl: async (_input, init) => {
        requestedBody = String(init?.body ?? '');
        return new Response(JSON.stringify({
          message: {
            content: '{"ok":true,"purpose":"model-smoke"}',
          },
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });

    assert.equal(result.success, true);
    assert.equal(result.parsedJson, true);
    assert.match(requestedBody, /"format"/);
    assert.match(requestedBody, /qwen3-coder:30b/);
  });

  it('runs the 10-case benchmark harness and persists the latest summary', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'Hephaestus-model-benchmark-'));
    tempDirs.push(tempRoot);
    const benchmarkConfig: Config = {
      ...makeConfig(),
      baseDir: tempRoot,
      tasksFile: path.join(tempRoot, 'TASKS.md'),
      ticketStoreFile: path.join(tempRoot, '.hephaestus-tickets.db'),
      agentMemoryFile: path.join(tempRoot, 'AGENT.md'),
      progressLog: path.join(tempRoot, 'PROGRESS.log'),
    };

    const result = await runOllamaModelBenchmark(benchmarkConfig, {
      model: 'codellama:latest',
      fetchImpl: async (_input, _init) => {
        return new Response(JSON.stringify({
          message: {
            content: '{"task":"safe-escalation","phase":"escalate","reason":"policy"}',
          },
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });

    assert.equal(result.caseCount, 10);
    assert.ok(typeof result.latestReportPath === 'string' && result.latestReportPath.length > 0);

    const summary = await readLatestModelBenchmarkSummary(tempRoot);
    assert.equal(summary.available, true);
    assert.equal(summary.caseCount, 10);
    assert.equal(summary.model, 'codellama:latest');
  });
});
