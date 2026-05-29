import { readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { config } from './config.js';
import {
  assessBenchmarkFreshness,
  buildModelStatus,
  defaultDiagnosticsTimeoutMs,
  fetchOllamaModelInventory,
  readLatestModelBenchmarkSummary,
  runOllamaModelBenchmark,
  runOllamaModelSmokeTest,
} from './model-diagnostics.js';

function printUsage(): void {
  console.log(`Hephaestus model diagnostics

Usage:
  npm run models:report
  npm run models:smoke -- [model]
  npm run models:benchmark -- [--models <model[,model...]>]
  npm run models:recommend
  npm run models:promote -- [--model <model>] [--min-success <ratio>]
  npm run models:warmup -- [model] [--timeout-ms <ms>]
`);
}

function parseOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) {
    return undefined;
  }

  return args[index + 1];
}

async function printReport(): Promise<void> {
  const inventory = await fetchOllamaModelInventory(config);
  const status = buildModelStatus(config, inventory);
  const benchmark = await readLatestModelBenchmarkSummary(config.baseDir);
  const profile = status.profile.profile;

  console.log(`Backend: ${status.backend}`);
  console.log(`Active model: ${status.activeModel}`);
  console.log(`Profile: ${status.summary}`);
  console.log(`Known profile: ${status.profile.known ? 'yes' : 'no'}`);
  console.log(`Recommended task class: ${profile.recommendedTaskClass}`);
  console.log(`Context window: ${profile.contextWindowTokens ? profile.contextWindowTokens.toLocaleString() : 'unknown'}`);
  console.log(`Minimum memory: ${profile.minimumMemoryGb ? `${profile.minimumMemoryGb} GB` : 'unknown'}`);
  console.log(`Capabilities: chat=${profile.capabilities.chat}, structured=${profile.capabilities.structuredOutputs}, tools=${profile.capabilities.toolCalling}, thinking=${profile.capabilities.thinkingControls}`);

  if (!inventory.available && inventory.error) {
    console.log(`Inventory: unavailable (${inventory.error})`);
  } else if (inventory.models.length === 0) {
    console.log('Inventory: no Ollama models reported.');
  } else {
    console.log('Installed Ollama models:');
    for (const model of inventory.models) {
      const size = model.sizeGb === undefined ? 'unknown size' : `${model.sizeGb} GB`;
      const known = model.profile.known ? 'profiled' : 'unprofiled';
      console.log(`- ${model.name} (${size}, ${known})`);
    }
  }

  console.log('Recommendations:');
  for (const recommendation of status.recommendations) {
    console.log(`- ${recommendation.model}: ${recommendation.installed ? 'installed' : 'not installed'} - ${recommendation.reason}`);
  }

  console.log('Routing policy evidence:');
  console.log(`- Local preferred task class: ${status.routingPolicy.localPreferredTaskClass}`);
  console.log(`- Max local retries: ${status.routingPolicy.maxLocalRetries}`);
  console.log(`- Escalation triggers: ${status.routingPolicy.escalationTriggers.join('; ')}`);
  console.log(`- Codex handoff summary: ${status.routingPolicy.codexHandoffSummary}`);

  if (benchmark.available) {
    const freshness = assessBenchmarkFreshness(benchmark);
    console.log('Latest benchmark summary:');
    console.log(`- Model: ${benchmark.model}`);
    console.log(`- Success rate: ${Number(benchmark.successRate ?? 0).toFixed(2)}`);
    console.log(`- Cases: ${benchmark.caseCount ?? 0}`);
    console.log(`- Generated at: ${benchmark.generatedAt ?? '-'}`);
    console.log(`- Freshness: ${freshness.status}${typeof freshness.ageHours === 'number' ? ` (${freshness.ageHours.toFixed(2)}h old)` : ''}`);
    if (benchmark.latestReportPath) {
      console.log(`- Report: ${benchmark.latestReportPath}`);
    }
  } else {
    console.log('Latest benchmark summary: unavailable');
  }
}

async function runSmoke(args: string[]): Promise<void> {
  const model = args[0] || config.aiModel || undefined;
  const timeoutMs = parseTimeoutMs(args, model || config.aiModel || 'codellama');
  const result = await runOllamaModelSmokeTest(config, { model, timeoutMs });
  console.log(`Model: ${result.model}`);
  console.log(`Success: ${result.success}`);
  console.log(`Parsed JSON: ${result.parsedJson}`);
  console.log(`Latency: ${result.latencyMs} ms`);
  if (result.error) {
    console.log(`Error: ${result.error}`);
  } else {
    console.log(`Content: ${result.content}`);
  }

  if (!result.success) {
    process.exitCode = 1;
  }
}

async function runBenchmark(args: string[]): Promise<void> {
  const modelsRaw = parseOption(args, '--models') || config.aiModel || 'codellama';
  const timeoutMs = parseTimeoutMs(args, modelsRaw.split(',')[0] || config.aiModel || 'codellama');
  const models = modelsRaw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  for (const model of models) {
    const result = await runOllamaModelBenchmark(config, { model, timeoutMs });
    console.log(`\nModel: ${result.model}`);
    console.log(`Success rate: ${result.successRate.toFixed(2)}`);
    console.log(`Case count: ${result.caseCount}`);
    if (result.latestReportPath) {
      console.log(`Report path: ${result.latestReportPath}`);
    }
    for (const benchmarkCase of result.cases) {
      const status = benchmarkCase.success ? 'pass' : 'fail';
      const family = benchmarkCase.failureFamily ? `, family=${benchmarkCase.failureFamily}` : '';
      const error = benchmarkCase.error ? ` (${benchmarkCase.error})` : '';
      console.log(`- ${benchmarkCase.name}: ${status}, parsed=${benchmarkCase.parsedJson}, latency=${benchmarkCase.latencyMs} ms, expected=${benchmarkCase.expectedSignal}${family}${error}`);
    }
    if (result.successRate < 1) {
      process.exitCode = 1;
    }
  }
}

async function runRecommend(): Promise<void> {
  const inventory = await fetchOllamaModelInventory(config);
  const status = buildModelStatus(config, inventory);
  const benchmark = await readLatestModelBenchmarkSummary(config.baseDir);
  const memoryGb = Math.round((os.totalmem() / 1024 / 1024 / 1024) * 10) / 10;
  const memoryTier = memoryGb >= 32 ? 'serious-local' : memoryGb >= 16 ? 'small-local' : 'minimal-local';

  console.log(`Host memory: ${memoryGb} GB (${memoryTier})`);
  console.log(`Active model: ${status.activeModel}`);
  console.log('Recommendations:');
  for (const recommendation of status.recommendations) {
    const state = recommendation.installed ? 'installed' : 'not installed';
    console.log(`- ${recommendation.model}: ${state} - ${recommendation.reason}`);
  }

  if (benchmark.available) {
    console.log(`Latest benchmark: model=${benchmark.model}, success=${Number(benchmark.successRate ?? 0).toFixed(2)}, cases=${benchmark.caseCount ?? 0}`);
  }
}

async function runPromote(args: string[]): Promise<void> {
  const requestedModel = parseOption(args, '--model');
  const minSuccessRaw = parseOption(args, '--min-success');
  const timeoutMs = parseTimeoutMs(args, requestedModel || config.aiModel || 'codellama');
  const minSuccess = minSuccessRaw ? Number(minSuccessRaw) : 0.75;
  if (!Number.isFinite(minSuccess) || minSuccess <= 0 || minSuccess > 1) {
    throw new Error('--min-success must be a number in (0, 1].');
  }

  const inventory = await fetchOllamaModelInventory(config);
  const installed = new Set(inventory.models.map((model) => model.name.toLowerCase()));
  const fallbackModel = inventory.models.find((model) => model.name.toLowerCase() !== 'codellama:latest')?.name;
  const model = requestedModel || fallbackModel || config.aiModel || 'codellama:latest';

  if (!installed.has(model.toLowerCase())) {
    throw new Error(`Cannot promote ${model}: model is not installed.`);
  }

  let benchmark = await readLatestModelBenchmarkSummary(config.baseDir);
  if (!benchmark.available || benchmark.model?.toLowerCase() !== model.toLowerCase()) {
    console.log(`No fresh benchmark for ${model}; running benchmark now...`);
    const executed = await runOllamaModelBenchmark(config, { model, persist: true, timeoutMs });
    benchmark = {
      available: true,
      model: executed.model,
      successRate: executed.successRate,
      caseCount: executed.caseCount,
      generatedAt: executed.savedAt,
      latestReportPath: executed.latestReportPath,
    };
  }

  const successRate = Number(benchmark.successRate ?? 0);
  const caseCount = Number(benchmark.caseCount ?? 0);
  const freshness = assessBenchmarkFreshness(benchmark, 168);
  if (caseCount < 10 || successRate < minSuccess || freshness.status !== 'fresh') {
    console.log(
      `Promotion blocked for ${model}: success=${successRate.toFixed(2)}, cases=${caseCount}, threshold=${minSuccess.toFixed(2)}, freshness=${freshness.status}.`
    );
    process.exitCode = 1;
    return;
  }

  const envPath = path.join(config.baseDir, '.env');
  await updateEnvModel(envPath, model);
  console.log(`Promoted ${model} to default AI_MODEL in ${envPath}.`);
}

async function runWarmup(args: string[]): Promise<void> {
  const model = args[0] || config.aiModel || 'codellama';
  const timeoutMs = parseTimeoutMs(args, model);
  const result = await runOllamaModelSmokeTest(config, { model, timeoutMs });
  console.log(`Warmup model: ${model}`);
  console.log(`Timeout: ${timeoutMs} ms`);
  console.log(`Success: ${result.success}`);
  console.log(`Latency: ${result.latencyMs} ms`);
  if (result.error) {
    console.log(`Error: ${result.error}`);
    process.exitCode = 1;
  }
}

function parseTimeoutMs(args: string[], model: string): number {
  const timeoutRaw = parseOption(args, '--timeout-ms');
  if (!timeoutRaw) {
    return defaultDiagnosticsTimeoutMs(model);
  }

  const timeoutMs = Number(timeoutRaw);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('--timeout-ms must be a positive number.');
  }

  return timeoutMs;
}

async function updateEnvModel(envPath: string, model: string): Promise<void> {
  let content = '';
  try {
    content = await readFile(envPath, 'utf-8');
  } catch {
    content = '';
  }

  const lines = content.length > 0 ? content.split(/\r?\n/) : [];
  let found = false;
  const updated = lines.map((line) => {
    if (/^\s*AI_MODEL\s*=/.test(line)) {
      found = true;
      return `AI_MODEL=${model}`;
    }
    return line;
  });

  if (!found) {
    updated.push(`AI_MODEL=${model}`);
  }

  await writeFile(envPath, `${updated.filter((line) => line !== undefined).join('\n')}\n`, 'utf-8');
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);

  if (!command || command === '--help' || command === '-h' || command === 'help') {
    printUsage();
    return;
  }

  if (command === 'report') {
    await printReport();
    return;
  }

  if (command === 'smoke') {
    await runSmoke(args);
    return;
  }

  if (command === 'benchmark') {
    await runBenchmark(args);
    return;
  }

  if (command === 'recommend') {
    await runRecommend();
    return;
  }

  if (command === 'promote') {
    await runPromote(args);
    return;
  }

  if (command === 'warmup') {
    await runWarmup(args);
    return;
  }

  throw new Error(`Unknown model diagnostic command: ${command}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
