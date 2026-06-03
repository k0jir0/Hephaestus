import type { TaskTicket } from './types.js';

const h50BenchmarkPathPattern = /docs[\\/]+metrics[\\/]+hephaestus-50-ticket-test\.md/i;
const h50BenchmarkCheckpointPattern = /\bH50J3-\d+\b/i;
const qwenWaveMetricsPathPattern = /docs[\\/]+metrics[\\/]+qwen-wave[\\/]+/i;

export function isSyntheticBenchmarkTicket(ticket: Pick<TaskTicket, 'description'>): boolean {
  const description = String(ticket.description ?? '').trim();
  if (h50BenchmarkPathPattern.test(description) && h50BenchmarkCheckpointPattern.test(description)) {
    return true;
  }

  return qwenWaveMetricsPathPattern.test(description);
}

export function isOperationalTicket(ticket: Pick<TaskTicket, 'description'>): boolean {
  return !isSyntheticBenchmarkTicket(ticket);
}