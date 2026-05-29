import { assessSourceGrounding, extractSourceGroundingKeys } from './domain/policy/source-grounding-policy.js';
import type { TaskTicket } from './types.js';

export interface SourceGroundingMetrics {
  totalTickets: number;
  requiredTickets: number;
  groundedTickets: number;
  missingGroundingTickets: string[];
  groundingCoverage: number;
  groundingKeyCounts: Array<{
    key: string;
    count: number;
  }>;
}

export function computeSourceGroundingMetrics(tickets: TaskTicket[]): SourceGroundingMetrics {
  let requiredTickets = 0;
  let groundedTickets = 0;
  const missingGroundingTickets: string[] = [];
  const groundingKeyCounts = new Map<string, number>();

  for (const ticket of tickets) {
    const assessment = assessSourceGrounding(ticket.description);
    if (!assessment.requiresGrounding) {
      continue;
    }

    requiredTickets += 1;
    if (assessment.grounded) {
      groundedTickets += 1;
      for (const key of extractSourceGroundingKeys(ticket.description)) {
        groundingKeyCounts.set(key, (groundingKeyCounts.get(key) ?? 0) + 1);
      }
    } else {
      missingGroundingTickets.push(ticket.id);
    }
  }

  return {
    totalTickets: tickets.length,
    requiredTickets,
    groundedTickets,
    missingGroundingTickets,
    groundingCoverage: requiredTickets > 0 ? groundedTickets / requiredTickets : 1,
    groundingKeyCounts: [...groundingKeyCounts.entries()]
      .map(([key, count]) => ({ key, count }))
      .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key)),
  };
}

export function formatSourceGroundingMetrics(metrics: SourceGroundingMetrics): string {
  const coveragePct = (metrics.groundingCoverage * 100).toFixed(1);
  const orderedGroundingKeys = [...metrics.groundingKeyCounts].sort(
    (left, right) => right.count - left.count || left.key.localeCompare(right.key)
  );
  const lines = [
    'Source Grounding Coverage',
    `- Total tickets: ${metrics.totalTickets}`,
    `- Blueprint/D2+ tickets requiring grounding: ${metrics.requiredTickets}`,
    `- Grounded tickets: ${metrics.groundedTickets}`,
    `- Coverage: ${coveragePct}%`,
  ];

  if (metrics.missingGroundingTickets.length > 0) {
    lines.push(
      `- Missing grounding ticket IDs (${metrics.missingGroundingTickets.length}): ${metrics.missingGroundingTickets
        .slice(0, 10)
        .join(', ')}`
    );
  } else {
    lines.push('- Missing grounding ticket IDs: none');
  }

  if (orderedGroundingKeys.length > 0) {
    lines.push(
      `- Grounding key usage: ${orderedGroundingKeys
        .slice(0, 10)
        .map((entry) => `${entry.key}=${entry.count}`)
        .join(', ')}`
    );
  } else {
    lines.push('- Grounding key usage: none');
  }

  return lines.join('\n');
}
