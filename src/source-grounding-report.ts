import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TicketStoreRepository } from './task-store.js';
import { computeSourceGroundingMetrics } from './source-grounding-metrics.js';
import { assessSourceGrounding, extractSourceGroundingKeys } from './domain/policy/source-grounding-policy.js';
import type { TaskEvent, TaskTicket } from './types.js';

export interface SourceGroundingDriftAudit {
  auditableTickets: number;
  ticketsWithEventEvidence: number;
  eventEvidenceCoverage: number;
  driftedTickets: string[];
  missingEvidenceTickets: string[];
}

export interface SourceGroundingSnapshot {
  timestamp: string;
  totalTickets: number;
  requiredTickets: number;
  groundedTickets: number;
  groundingCoverage: number;
  missingGroundingTickets: string[];
  groundingKeyCounts: Array<{
    key: string;
    count: number;
  }>;
  eventEvidence: SourceGroundingDriftAudit;
}

const METRICS_DIR = path.join('docs', 'metrics');
const LATEST_FILE = path.join(METRICS_DIR, 'source-grounding-latest.json');
const HISTORY_FILE = path.join(METRICS_DIR, 'source-grounding-history.jsonl');
const REPORT_FILE = path.join(METRICS_DIR, 'source-grounding-report.md');

function setsEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  const rightSet = new Set(right);
  return left.every((entry) => rightSet.has(entry));
}

export function extractEventEvidenceKeys(event: TaskEvent): string[] {
  if (!event.evidence) {
    return [];
  }

  const direct = event.evidence.sourceGroundingKeys;
  if (Array.isArray(direct) && direct.every((entry) => typeof entry === 'string')) {
    return [...new Set(direct)].sort();
  }

  const amended = event.evidence.sourceGroundingKeysAfter;
  if (Array.isArray(amended) && amended.every((entry) => typeof entry === 'string')) {
    return [...new Set(amended)].sort();
  }

  return [];
}

export function buildSourceGroundingDriftAudit(
  tickets: TaskTicket[],
  events: TaskEvent[]
): SourceGroundingDriftAudit {
  const latestEvidenceByTicket = new Map<string, string[]>();
  for (const event of events) {
    if (event.type !== 'created' && event.type !== 'amended' && event.type !== 'requeued') {
      continue;
    }

    const keys = extractEventEvidenceKeys(event);
    if (keys.length === 0) {
      continue;
    }

    latestEvidenceByTicket.set(event.ticketId, keys);
  }

  const auditableTickets = tickets.filter((ticket) => {
    const assessment = assessSourceGrounding(ticket.description);
    return assessment.requiresGrounding && assessment.grounded;
  });

  const driftedTickets: string[] = [];
  const missingEvidenceTickets: string[] = [];
  let ticketsWithEventEvidence = 0;

  for (const ticket of auditableTickets) {
    const expected = [...new Set(extractSourceGroundingKeys(ticket.description))].sort();
    const observed = latestEvidenceByTicket.get(ticket.id) ?? [];

    if (observed.length === 0) {
      missingEvidenceTickets.push(ticket.id);
      continue;
    }

    ticketsWithEventEvidence += 1;
    if (!setsEqual(expected, observed)) {
      driftedTickets.push(ticket.id);
    }
  }

  return {
    auditableTickets: auditableTickets.length,
    ticketsWithEventEvidence,
    eventEvidenceCoverage: auditableTickets.length > 0 ? ticketsWithEventEvidence / auditableTickets.length : 1,
    driftedTickets,
    missingEvidenceTickets,
  };
}

function buildSnapshot(
  now: number,
  metrics: ReturnType<typeof computeSourceGroundingMetrics>,
  eventEvidence: SourceGroundingDriftAudit
): SourceGroundingSnapshot {
  return {
    timestamp: new Date(now).toISOString(),
    totalTickets: metrics.totalTickets,
    requiredTickets: metrics.requiredTickets,
    groundedTickets: metrics.groundedTickets,
    groundingCoverage: Number(metrics.groundingCoverage.toFixed(3)),
    missingGroundingTickets: metrics.missingGroundingTickets,
    groundingKeyCounts: metrics.groundingKeyCounts,
    eventEvidence: {
      ...eventEvidence,
      eventEvidenceCoverage: Number(eventEvidence.eventEvidenceCoverage.toFixed(3)),
    },
  };
}

export function renderReport(snapshot: SourceGroundingSnapshot): string {
  return [
    '# Source Grounding Report',
    '',
    `Generated: ${snapshot.timestamp}`,
    '',
    '## Coverage',
    `- Total tickets: ${snapshot.totalTickets}`,
    `- Blueprint/D2+ tickets requiring grounding: ${snapshot.requiredTickets}`,
    `- Grounded tickets: ${snapshot.groundedTickets}`,
    `- Coverage: ${(snapshot.groundingCoverage * 100).toFixed(1)}%`,
    '',
    '## Missing Grounding',
    ...(snapshot.missingGroundingTickets.length > 0
      ? snapshot.missingGroundingTickets.slice(0, 20).map((ticketId) => `- ${ticketId}`)
      : ['- none']),
    '',
    '## Grounding Key Histogram',
    ...(snapshot.groundingKeyCounts.length > 0
      ? snapshot.groundingKeyCounts.map((entry) => `- ${entry.key}: ${entry.count}`)
      : ['- none']),
    '',
    '## Event Evidence Drift Audit',
    `- Auditable tickets: ${snapshot.eventEvidence.auditableTickets}`,
    `- Tickets with event evidence: ${snapshot.eventEvidence.ticketsWithEventEvidence}`,
    `- Event evidence coverage: ${(snapshot.eventEvidence.eventEvidenceCoverage * 100).toFixed(1)}%`,
    ...(snapshot.eventEvidence.missingEvidenceTickets.length > 0
      ? [
          `- Missing event evidence tickets (${snapshot.eventEvidence.missingEvidenceTickets.length}): ${snapshot.eventEvidence.missingEvidenceTickets
            .slice(0, 20)
            .join(', ')}`,
        ]
      : ['- Missing event evidence tickets: none']),
    ...(snapshot.eventEvidence.driftedTickets.length > 0
      ? [
          `- Drifted tickets (${snapshot.eventEvidence.driftedTickets.length}): ${snapshot.eventEvidence.driftedTickets
            .slice(0, 20)
            .join(', ')}`,
        ]
      : ['- Drifted tickets: none']),
    '',
  ].join('\n');
}

async function collectSnapshot(): Promise<SourceGroundingSnapshot> {
  const repository = new TicketStoreRepository({ projectionEnabled: false });
  try {
    const tickets = await repository.listTickets('all');
    const events = await repository.listEvents();
    const metrics = computeSourceGroundingMetrics(tickets);
    const eventEvidence = buildSourceGroundingDriftAudit(tickets, events);
    return buildSnapshot(Date.now(), metrics, eventEvidence);
  } finally {
    await repository.stop();
  }
}

async function persist(snapshot: SourceGroundingSnapshot): Promise<void> {
  await fs.mkdir(METRICS_DIR, { recursive: true });
  await fs.writeFile(LATEST_FILE, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf-8');
  await fs.appendFile(HISTORY_FILE, `${JSON.stringify(snapshot)}\n`, 'utf-8');
  await fs.writeFile(REPORT_FILE, `${renderReport(snapshot)}\n`, 'utf-8');
}

async function main(): Promise<void> {
  const snapshot = await collectSnapshot();
  await persist(snapshot);
  console.log(`Source grounding snapshot written to ${LATEST_FILE}`);
  console.log(`Coverage: ${(snapshot.groundingCoverage * 100).toFixed(1)}%`);
  console.log(`Event evidence coverage: ${(snapshot.eventEvidence.eventEvidenceCoverage * 100).toFixed(1)}%`);
  if (snapshot.missingGroundingTickets.length > 0) {
    console.log(`Missing grounding tickets: ${snapshot.missingGroundingTickets.length}`);
  }
  if (snapshot.eventEvidence.driftedTickets.length > 0) {
    console.log(`Drifted tickets: ${snapshot.eventEvidence.driftedTickets.length}`);
  }
}

function isDirectExecution(): boolean {
  if (!process.argv[1]) {
    return false;
  }

  return path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isDirectExecution()) {
  main().catch((error) => {
    console.error(
      'Failed to collect source grounding report:',
      error instanceof Error ? error.message : String(error)
    );
    process.exit(1);
  });
}
