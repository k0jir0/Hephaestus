import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Config } from './config.js';
import {
  bytesToGb,
  recommendModel,
  resolveModelProfile,
  summarizeModelProfile,
  type InstalledOllamaModel,
  type ModelRecommendation,
  type ResolvedModelProfile,
} from './model-profiles.js';

export interface ModelStatus {
  backend: string;
  activeModel: string;
  profile: ResolvedModelProfile;
  summary: string;
  recommendations: ModelRecommendation[];
  routingPolicy: ModelRoutingPolicyEvidence;
  benchmark: ModelBenchmarkSummary;
}

export interface ModelRoutingPolicyEvidence {
  localPreferredTaskClass: string;
  maxLocalRetries: number;
  escalationTriggers: string[];
  codexHandoffSummary: string;
}

export interface ModelInventory {
  available: boolean;
  source: 'ollama' | 'skipped';
  models: InstalledOllamaModel[];
  error?: string;
}

export interface ModelSmokeResult {
  model: string;
  success: boolean;
  parsedJson: boolean;
  latencyMs: number;
  content: string;
  error?: string;
}

export interface ModelBenchmarkCaseResult {
  name: string;
  success: boolean;
  parsedJson: boolean;
  expectedSignal: string;
  latencyMs: number;
  error?: string;
  failureFamily?: ModelBenchmarkFailureFamily;
}

export interface ModelBenchmarkResult {
  model: string;
  successRate: number;
  caseCount: number;
  cases: ModelBenchmarkCaseResult[];
  savedAt?: string;
  latestReportPath?: string;
}

export type ModelBenchmarkFailureFamily = 'parse' | 'policy' | 'escalation' | 'transport' | 'unknown';

export interface ModelBenchmarkSummary {
  available: boolean;
  model?: string;
  successRate?: number;
  caseCount?: number;
  generatedAt?: string;
  latestReportPath?: string;
  historyPath?: string;
}

interface BenchmarkCase {
  name: string;
  prompt: string;
  expectedSignal: string;
  validate: (value: Record<string, unknown>) => boolean;
}

interface PersistedBenchmarkReport {
  model: string;
  successRate: number;
  caseCount: number;
  generatedAt: string;
  cases: ModelBenchmarkCaseResult[];
}

interface OllamaTagsResponse {
  models?: Array<{
    name?: string;
    model?: string;
    modified_at?: string;
    size?: number;
    digest?: string;
    details?: {
      family?: string;
      parameter_size?: string;
      quantization_level?: string;
    };
  }>;
}

interface OllamaChatResponse {
  message?: {
    content?: string;
  };
  response?: string;
  error?: string;
}

export type DiagnosticsFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export function buildModelStatus(config: Config, inventory: ModelInventory = emptyInventory()): ModelStatus {
  const activeModel = config.aiModel || defaultModelForBackend(config.aiBackend);
  const profile = resolveModelProfile(activeModel, config.aiBackend);
  return {
    backend: config.aiBackend,
    activeModel,
    profile,
    summary: summarizeModelProfile(activeModel, config.aiBackend),
    recommendations: recommendModel(inventory.models),
    routingPolicy: buildRoutingPolicyEvidence(profile),
    benchmark: emptyBenchmarkSummary(),
  };
}

export async function fetchOllamaModelInventory(
  config: Config,
  fetchImpl: DiagnosticsFetch = fetch,
  timeoutMs = 1_500
): Promise<ModelInventory> {
  if (config.aiBackend !== 'ollama') {
    return emptyInventory('skipped');
  }

  try {
    const response = await fetchImpl(`${config.ollamaBaseUrl}/api/tags`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      return {
        available: false,
        source: 'ollama',
        models: [],
        error: `Ollama tags request failed: ${response.status} ${response.statusText}`,
      };
    }

    return parseOllamaTagsResponse(await response.json());
  } catch (error) {
    return {
      available: false,
      source: 'ollama',
      models: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function parseOllamaTagsResponse(payload: unknown): ModelInventory {
  const response = payload as OllamaTagsResponse;
  const models = Array.isArray(response.models) ? response.models : [];
  return {
    available: true,
    source: 'ollama',
    models: models
      .map((model) => {
        const name = model.name || model.model || '';
        return {
          name,
          sizeBytes: model.size,
          sizeGb: bytesToGb(model.size),
          modifiedAt: model.modified_at,
          digest: model.digest,
          family: model.details?.family,
          parameterSize: model.details?.parameter_size,
          quantizationLevel: model.details?.quantization_level,
          profile: resolveModelProfile(name || 'unknown', 'ollama'),
        } satisfies InstalledOllamaModel;
      })
      .filter((model) => model.name.length > 0),
  };
}

export async function runOllamaModelSmokeTest(
  config: Config,
  options: {
    model?: string;
    fetchImpl?: DiagnosticsFetch;
    timeoutMs?: number;
  } = {}
): Promise<ModelSmokeResult> {
  const model = options.model || config.aiModel || 'codellama';
  const startedAt = Date.now();

  if (config.aiBackend !== 'ollama') {
    return {
      model,
      success: false,
      parsedJson: false,
      latencyMs: 0,
      content: '',
      error: `Smoke tests currently target the ollama backend, not ${config.aiBackend}.`,
    };
  }

  try {
    const content = await requestOllamaJson(config, {
      model,
      prompt: 'Return {"ok": true, "purpose": "model-smoke"} as strict JSON.',
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          purpose: { type: 'string' },
        },
        required: ['ok', 'purpose'],
      },
      fetchImpl: options.fetchImpl,
      timeoutMs: options.timeoutMs,
    });
    const parsed = JSON.parse(content) as { ok?: boolean };
    return {
      model,
      success: parsed.ok === true,
      parsedJson: true,
      latencyMs: Date.now() - startedAt,
      content,
    };
  } catch (error) {
    return {
      model,
      success: false,
      parsedJson: false,
      latencyMs: Date.now() - startedAt,
      content: '',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function runOllamaModelBenchmark(
  config: Config,
  options: {
    model?: string;
    fetchImpl?: DiagnosticsFetch;
    timeoutMs?: number;
    persist?: boolean;
  } = {}
): Promise<ModelBenchmarkResult> {
  const model = options.model || config.aiModel || 'codellama';
  const cases = buildBenchmarkCases();

  const results: ModelBenchmarkCaseResult[] = [];
  for (const benchmarkCase of cases) {
    const startedAt = Date.now();
    try {
      const content = await requestOllamaJson(config, {
        model,
        prompt: benchmarkCase.prompt,
        schema: { type: 'object' },
        fetchImpl: options.fetchImpl,
        timeoutMs: options.timeoutMs,
      });
      const parsed = JSON.parse(content) as Record<string, unknown>;
      results.push({
        name: benchmarkCase.name,
        success: benchmarkCase.validate(parsed),
        parsedJson: true,
        expectedSignal: benchmarkCase.expectedSignal,
        latencyMs: Date.now() - startedAt,
      });
    } catch (error) {
      results.push({
        name: benchmarkCase.name,
        success: false,
        parsedJson: false,
        expectedSignal: benchmarkCase.expectedSignal,
        latencyMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
        failureFamily: classifyBenchmarkFailure(error instanceof Error ? error.message : String(error)),
      });
    }
  }

  const successes = results.filter((result) => result.success).length;
  const summary: ModelBenchmarkResult = {
    model,
    successRate: results.length === 0 ? 0 : successes / results.length,
    caseCount: results.length,
    cases: results,
  };

  if (options.persist !== false) {
    const persisted = await persistModelBenchmarkReport(config.baseDir, summary);
    summary.savedAt = persisted.generatedAt;
    summary.latestReportPath = persisted.latestReportPath;
  }

  return summary;
}

export async function readLatestModelBenchmarkSummary(baseDir: string): Promise<ModelBenchmarkSummary> {
  const latestPath = getBenchmarkLatestPath(baseDir);
  const historyPath = getBenchmarkHistoryPath(baseDir);
  try {
    const raw = await readFile(latestPath, 'utf-8');
    const parsed = JSON.parse(raw) as PersistedBenchmarkReport;
    return {
      available: true,
      model: parsed.model,
      successRate: parsed.successRate,
      caseCount: parsed.caseCount,
      generatedAt: parsed.generatedAt,
      latestReportPath: latestPath,
      historyPath,
    };
  } catch {
    return emptyBenchmarkSummary();
  }
}

function buildBenchmarkCases(): BenchmarkCase[] {
  return [
    {
      name: 'documentation-edit',
      prompt: 'Return {"task":"documentation-edit","phase":"edit","safe":true} as strict JSON.',
      expectedSignal: 'phase=edit',
      validate: (value) => value.task === 'documentation-edit' && value.phase === 'edit' && value.safe === true,
    },
    {
      name: 'small-test-addition',
      prompt: 'Return {"task":"small-test-addition","phase":"verify","command":"npm test"} as strict JSON.',
      expectedSignal: 'safe test command',
      validate: (value) => value.task === 'small-test-addition' && typeof value.command === 'string' && /^npm( run)? test\b/.test(value.command),
    },
    {
      name: 'simple-refactor',
      prompt: 'Return {"task":"simple-refactor","phase":"edit","bounded":true} as strict JSON.',
      expectedSignal: 'bounded=true',
      validate: (value) => value.task === 'simple-refactor' && value.phase === 'edit' && value.bounded === true,
    },
    {
      name: 'command-validation',
      prompt: 'Choose one safe repo verification command. Return {"task":"command-validation","command":"..."} as strict JSON.',
      expectedSignal: 'allowlisted npm command',
      validate: (value) =>
        value.task === 'command-validation' &&
        typeof value.command === 'string' &&
        /^npm( run)? (test|lint|build|preflight|validate:config|tickets)\b/.test(value.command),
    },
    {
      name: 'ui-copy-edit',
      prompt: 'Return {"task":"ui-copy-edit","phase":"edit","target":"ui"} as strict JSON.',
      expectedSignal: 'target=ui',
      validate: (value) => value.task === 'ui-copy-edit' && value.phase === 'edit' && value.target === 'ui',
    },
    {
      name: 'typescript-type-fix',
      prompt: 'Return {"task":"typescript-type-fix","phase":"edit","target":"types"} as strict JSON.',
      expectedSignal: 'target=types',
      validate: (value) => value.task === 'typescript-type-fix' && value.phase === 'edit' && value.target === 'types',
    },
    {
      name: 'failing-test-diagnosis',
      prompt: 'Return {"task":"failing-test-diagnosis","phase":"inspect","next":"run tests"} as strict JSON.',
      expectedSignal: 'phase=inspect',
      validate: (value) => value.task === 'failing-test-diagnosis' && value.phase === 'inspect' && typeof value.next === 'string',
    },
    {
      name: 'task-queue-edit',
      prompt: 'Return {"task":"task-queue-edit","phase":"summarize","safe":true} as strict JSON.',
      expectedSignal: 'phase=summarize',
      validate: (value) => value.task === 'task-queue-edit' && value.phase === 'summarize' && value.safe === true,
    },
    {
      name: 'metrics-inspection',
      prompt: 'Return {"task":"metrics-inspection","phase":"inspect","command":"npm run tickets -- metrics"} as strict JSON.',
      expectedSignal: 'metrics command present',
      validate: (value) => value.task === 'metrics-inspection' && typeof value.command === 'string' && /tickets -- metrics/.test(value.command),
    },
    {
      name: 'safe-escalation',
      prompt: 'A task requires destructive git history rewrite. Return {"task":"safe-escalation","phase":"escalate","reason":"..."} as strict JSON.',
      expectedSignal: 'phase=escalate',
      validate: (value) => value.task === 'safe-escalation' && value.phase === 'escalate' && typeof value.reason === 'string' && value.reason.length > 0,
    },
  ];
}

async function persistModelBenchmarkReport(baseDir: string, result: ModelBenchmarkResult): Promise<{ generatedAt: string; latestReportPath: string }> {
  const generatedAt = new Date().toISOString();
  const latestPath = getBenchmarkLatestPath(baseDir);
  const historyPath = getBenchmarkHistoryPath(baseDir);
  await mkdir(path.dirname(latestPath), { recursive: true });

  const report: PersistedBenchmarkReport = {
    model: result.model,
    successRate: result.successRate,
    caseCount: result.caseCount,
    generatedAt,
    cases: result.cases,
  };

  await writeFile(latestPath, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
  await appendFile(historyPath, `${JSON.stringify(report)}\n`, 'utf-8');

  return { generatedAt, latestReportPath: latestPath };
}

function classifyBenchmarkFailure(message: string): ModelBenchmarkFailureFamily {
  if (/json|parse|empty response/i.test(message)) {
    return 'parse';
  }
  if (/allowlist|policy|denied/i.test(message)) {
    return 'policy';
  }
  if (/escalate|escalation/i.test(message)) {
    return 'escalation';
  }
  if (/timeout|failed|error|ollama/i.test(message)) {
    return 'transport';
  }
  return 'unknown';
}

function getBenchmarkLatestPath(baseDir: string): string {
  return path.join(baseDir, 'docs', 'metrics', 'model-benchmark-latest.json');
}

function getBenchmarkHistoryPath(baseDir: string): string {
  return path.join(baseDir, 'docs', 'metrics', 'model-benchmark-history.jsonl');
}

function emptyBenchmarkSummary(): ModelBenchmarkSummary {
  return { available: false };
}

async function requestOllamaJson(
  config: Config,
  options: {
    model: string;
    prompt: string;
    schema: Record<string, unknown>;
    fetchImpl?: DiagnosticsFetch;
    timeoutMs?: number;
  }
): Promise<string> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(`${config.ollamaBaseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
    body: JSON.stringify({
      model: options.model,
      stream: false,
      format: options.schema,
      options: {
        temperature: 0,
        num_predict: 512,
      },
      messages: [
        {
          role: 'system',
          content: 'Return JSON only. Do not include prose or markdown fences.',
        },
        {
          role: 'user',
          content: options.prompt,
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama chat request failed: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json() as OllamaChatResponse;
  if (payload.error) {
    throw new Error(payload.error);
  }

  const content = payload.message?.content ?? payload.response ?? '';
  if (!content.trim()) {
    throw new Error('Ollama returned an empty response.');
  }

  return extractJsonObject(content);
}

function extractJsonObject(content: string): string {
  const trimmed = content.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return trimmed;
  }

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace <= firstBrace) {
    throw new Error('Model response did not contain a JSON object.');
  }

  return trimmed.slice(firstBrace, lastBrace + 1);
}

function emptyInventory(source: 'ollama' | 'skipped' = 'ollama'): ModelInventory {
  return {
    available: source === 'skipped',
    source,
    models: [],
  };
}

function defaultModelForBackend(backend: string): string {
  if (backend === 'ollama') {
    return 'codellama';
  }

  if (backend === 'openai') {
    return 'gpt-4o-mini';
  }

  if (backend === 'claude') {
    return 'claude-3-5-sonnet-20241022';
  }

  return 'default';
}

function buildRoutingPolicyEvidence(profile: ResolvedModelProfile): ModelRoutingPolicyEvidence {
  const taskClass = profile.profile.recommendedTaskClass;
  const localPreferredTaskClass =
    taskClass === 'repository-coding' || taskClass === 'agentic-reasoning'
      ? 'focused-code-change, documentation-update, test-repair'
      : 'documentation-update, repository-inspection';

  return {
    localPreferredTaskClass,
    maxLocalRetries: 2,
    escalationTriggers: [
      'task status is blocked or awaiting_approval',
      'retry count exceeds local retry cap',
      'destructive or policy-denied action required',
      'ticket implies architecture, security, or broad migration scope',
    ],
    codexHandoffSummary:
      'When escalation is required, handoff should include recent artifacts, denied actions, and the next recommended lane (fast/deep).',
  };
}
