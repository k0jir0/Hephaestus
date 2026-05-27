import { pathToFileURL } from 'node:url';

export function validateConfig(env: Record<string, string | undefined> = process.env) {
  const allowed = ['ollama', 'openai', 'copilot', 'claude'];
  const backend = (env['AI_BACKEND'] || 'ollama').toLowerCase();
  if (!allowed.includes(backend)) {
    throw new Error(`Invalid AI_BACKEND: ${backend}. Allowed: ${allowed.join(', ')}`);
  }
  return { aiBackend: backend, dailyTokenBudget: env['DAILY_TOKEN_BUDGET'] || '10.00', maxIterations: env['MAX_ITERATIONS'] || '50' };
}

const isDirectRun = process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  try {
    const cfg = validateConfig();
    console.log('Config OK', cfg);
    process.exit(0);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(2);
  }
}
