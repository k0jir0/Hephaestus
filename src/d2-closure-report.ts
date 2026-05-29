import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TicketStoreRepository } from './task-store.js';

interface D2VerifierThresholds {
  maxCountMismatches: number;
  maxLegacyOnly: number;
  maxDomainOnly: number;
  maxDomainDeficit: number;
  maxMissingLegacyLink: number;
  minReplayCorrelationCoverage: number;
}

interface SourceGroundingSummary {
  timestamp?: string;
  ageHours?: number;
  groundingCoverage?: number;
  requiredTickets?: number;
  groundedTickets?: number;
  eventEvidenceCoverage?: number;
  driftedTickets?: number;
  missingEvidenceTickets?: number;
}

interface D2ClosureSnapshot {
  timestamp: string;
  thresholds: D2VerifierThresholds;
  eventSpine: {
    legacyEventCount: number;
    domainEventCount: number;
    domainEventDeficit: number;
    domainEventsWithLegacyLink: number;
    missingLegacyLinkRows: number;
    eventEvidenceCount: number;
    ticketsWithCountMismatch: number;
    ticketsWithLegacyOnlyEvents: number;
    ticketsWithDomainOnlyEvents: number;
  };
  replay: {
    ticketCount: number;
    totalEvents: number;
    correlationCoverage: number;
    replayHash: string;
    replayHashStable: boolean;
  };
  sourceGrounding?: SourceGroundingSummary;
  failures: string[];
  decision: 'PASS' | 'FAIL';
}

const METRICS_DIR = path.join('docs', 'metrics');
const LATEST_FILE = path.join(METRICS_DIR, 'd2-closure-latest.json');
const HISTORY_FILE = path.join(METRICS_DIR, 'd2-closure-history.jsonl');
const REPORT_FILE = path.join(METRICS_DIR, 'd2-closure-report.md');
const SOURCE_GROUNDING_LATEST = path.join(METRICS_DIR, 'source-grounding-latest.json');

const STRICT_THRESHOLDS: D2VerifierThresholds = {
  maxCountMismatches: 0,
  maxLegacyOnly: 0,
  maxDomainOnly: 0,
  maxDomainDeficit: 0,
  maxMissingLegacyLink: 0,
  minReplayCorrelationCoverage: 0.2,
};

function round(value: number): number {
  return Number(value.toFixed(3));
}

function computeFailures(
  thresholds: D2VerifierThresholds,
  spine: D2ClosureSnapshot['eventSpine'],
  replay: D2ClosureSnapshot['replay']
): string[] {
  const failures: string[] = [];

  if (spine.domainEventDeficit > thresholds.maxDomainDeficit) {
    failures.push(`d2-domain-deficit-high:${spine.domainEventDeficit}>${thresholds.maxDomainDeficit}`);
  }
  if (spine.ticketsWithCountMismatch > thresholds.maxCountMismatches) {
    failures.push(`d2-count-mismatch-high:${spine.ticketsWithCountMismatch}>${thresholds.maxCountMismatches}`);
  }
  if (spine.ticketsWithLegacyOnlyEvents > thresholds.maxLegacyOnly) {
    failures.push(`d2-legacy-only-high:${spine.ticketsWithLegacyOnlyEvents}>${thresholds.maxLegacyOnly}`);
  }
  if (spine.ticketsWithDomainOnlyEvents > thresholds.maxDomainOnly) {
    failures.push(`d2-domain-only-high:${spine.ticketsWithDomainOnlyEvents}>${thresholds.maxDomainOnly}`);
  }
  if (spine.missingLegacyLinkRows > thresholds.maxMissingLegacyLink) {
    failures.push(`d2-missing-legacy-link-high:${spine.missingLegacyLinkRows}>${thresholds.maxMissingLegacyLink}`);
  }
  if (replay.totalEvents <= 0) {
    failures.push('d2-replay-empty');
  }
  if (!replay.replayHashStable) {
    failures.push('d2-replay-hash-unstable');
  }
  if (replay.correlationCoverage < thresholds.minReplayCorrelationCoverage) {
    failures.push(
      `d2-replay-correlation-low:${replay.correlationCoverage.toFixed(3)}<${thresholds.minReplayCorrelationCoverage}`
    );
  }

  return failures;
}

async function readSourceGroundingSummary(now: number): Promise<SourceGroundingSummary | undefined> {
  try {
    const raw = await fs.readFile(SOURCE_GROUNDING_LATEST, 'utf-8');
    const parsed = JSON.parse(raw) as {
      timestamp?: string;
      groundingCoverage?: number;
      requiredTickets?: number;
      groundedTickets?: number;
      eventEvidence?: {
        eventEvidenceCoverage?: number;
        driftedTickets?: string[];
        missingEvidenceTickets?: string[];
      };
    };

    const parsedTimestampMs = parsed.timestamp ? Date.parse(parsed.timestamp) : Number.NaN;
    const ageHours = Number.isFinite(parsedTimestampMs)
      ? round((now - parsedTimestampMs) / (1000 * 60 * 60))
      : undefined;

    return {
      timestamp: parsed.timestamp,
      ageHours,
      groundingCoverage:
        typeof parsed.groundingCoverage === 'number' ? round(parsed.groundingCoverage) : undefined,
      requiredTickets:
        typeof parsed.requiredTickets === 'number' ? parsed.requiredTickets : undefined,
      groundedTickets:
        typeof parsed.groundedTickets === 'number' ? parsed.groundedTickets : undefined,
      eventEvidenceCoverage:
        typeof parsed.eventEvidence?.eventEvidenceCoverage === 'number'
          ? round(parsed.eventEvidence.eventEvidenceCoverage)
          : undefined,
      driftedTickets: parsed.eventEvidence?.driftedTickets?.length,
      missingEvidenceTickets: parsed.eventEvidence?.missingEvidenceTickets?.length,
    };
  } catch {
    return undefined;
  }
}

function renderReport(snapshot: D2ClosureSnapshot): string {
  return [
    '# D2 Closure Report',
    '',
    `Generated: ${snapshot.timestamp}`,
    `Decision: ${snapshot.decision}`,
    '',
    '## Strict Thresholds',
    `- maxCountMismatches: ${snapshot.thresholds.maxCountMismatches}`,
    `- maxLegacyOnly: ${snapshot.thresholds.maxLegacyOnly}`,
    `- maxDomainOnly: ${snapshot.thresholds.maxDomainOnly}`,
    `- maxDomainDeficit: ${snapshot.thresholds.maxDomainDeficit}`,
    `- maxMissingLegacyLink: ${snapshot.thresholds.maxMissingLegacyLink}`,
    `- minReplayCorrelationCoverage: ${snapshot.thresholds.minReplayCorrelationCoverage}`,
    '',
    '## Event Spine',
    `- Legacy events: ${snapshot.eventSpine.legacyEventCount}`,
    `- Domain events: ${snapshot.eventSpine.domainEventCount}`,
    `- Domain deficit: ${snapshot.eventSpine.domainEventDeficit}`,
    `- Domain events with legacy link: ${snapshot.eventSpine.domainEventsWithLegacyLink}`,
    `- Missing legacy link rows: ${snapshot.eventSpine.missingLegacyLinkRows}`,
    `- Event evidence rows: ${snapshot.eventSpine.eventEvidenceCount}`,
    `- Tickets with count mismatch: ${snapshot.eventSpine.ticketsWithCountMismatch}`,
    `- Tickets with legacy-only events: ${snapshot.eventSpine.ticketsWithLegacyOnlyEvents}`,
    `- Tickets with domain-only events: ${snapshot.eventSpine.ticketsWithDomainOnlyEvents}`,
    '',
    '## Replay',
    `- Replay tickets: ${snapshot.replay.ticketCount}`,
    `- Replay total events: ${snapshot.replay.totalEvents}`,
    `- Replay correlation coverage: ${snapshot.replay.correlationCoverage.toFixed(3)}`,
    `- Replay hash: ${snapshot.replay.replayHash}`,
    `- Replay hash stable across immediate rerun: ${snapshot.replay.replayHashStable ? 'yes' : 'no'}`,
    '',
    '## Source Grounding Context',
    ...(snapshot.sourceGrounding
      ? [
          `- Snapshot timestamp: ${snapshot.sourceGrounding.timestamp ?? 'unknown'}`,
          `- Snapshot age (hours): ${snapshot.sourceGrounding.ageHours ?? 'unknown'}`,
          `- Grounding coverage: ${(snapshot.sourceGrounding.groundingCoverage ?? 0).toFixed(3)}`,
          `- Grounded/required tickets: ${snapshot.sourceGrounding.groundedTickets ?? 0}/${snapshot.sourceGrounding.requiredTickets ?? 0}`,
          `- Event evidence coverage: ${(snapshot.sourceGrounding.eventEvidenceCoverage ?? 0).toFixed(3)}`,
          `- Drifted tickets: ${snapshot.sourceGrounding.driftedTickets ?? 0}`,
          `- Missing evidence tickets: ${snapshot.sourceGrounding.missingEvidenceTickets ?? 0}`,
        ]
      : ['- No source-grounding snapshot found.']),
    '',
    '## Failure Tokens',
    ...(snapshot.failures.length > 0 ? snapshot.failures.map((failure) => `- ${failure}`) : ['- none']),
    '',
  ].join('\n');
}

async function collectSnapshot(): Promise<D2ClosureSnapshot> {
  const now = Date.now();
  const repository = new TicketStoreRepository({ projectionEnabled: false });

  try {
    const eventSpineSnapshot = await repository.getD2EventSpineSnapshot();
    const replayA = await repository.getD2ReplaySummary();
    const replayB = await repository.getD2ReplaySummary();

    const eventSpine = {
      legacyEventCount: eventSpineSnapshot.legacyEventCount,
      domainEventCount: eventSpineSnapshot.domainEventCount,
      domainEventDeficit: Math.max(0, eventSpineSnapshot.legacyEventCount - eventSpineSnapshot.domainEventCount),
      domainEventsWithLegacyLink: eventSpineSnapshot.domainEventsWithLegacyLink,
      missingLegacyLinkRows: Math.max(
        0,
        eventSpineSnapshot.domainEventCount - eventSpineSnapshot.domainEventsWithLegacyLink
      ),
      eventEvidenceCount: eventSpineSnapshot.eventEvidenceCount,
      ticketsWithCountMismatch: eventSpineSnapshot.ticketsWithCountMismatch.length,
      ticketsWithLegacyOnlyEvents: eventSpineSnapshot.ticketsWithLegacyOnly.length,
      ticketsWithDomainOnlyEvents: eventSpineSnapshot.ticketsWithDomainOnly.length,
    };

    const replay = {
      ticketCount: replayA.ticketCount,
      totalEvents: replayA.totalEvents,
      correlationCoverage: replayA.correlationCoverage,
      replayHash: replayA.replayHash,
      replayHashStable: replayA.replayHash === replayB.replayHash,
    };

    const failures = computeFailures(STRICT_THRESHOLDS, eventSpine, replay);

    return {
      timestamp: new Date(now).toISOString(),
      thresholds: STRICT_THRESHOLDS,
      eventSpine,
      replay,
      sourceGrounding: await readSourceGroundingSummary(now),
      failures,
      decision: failures.length === 0 ? 'PASS' : 'FAIL',
    };
  } finally {
    await repository.stop();
  }
}

async function persistSnapshot(snapshot: D2ClosureSnapshot): Promise<void> {
  await fs.mkdir(METRICS_DIR, { recursive: true });
  await fs.writeFile(LATEST_FILE, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf-8');
  await fs.appendFile(HISTORY_FILE, `${JSON.stringify(snapshot)}\n`, 'utf-8');
  await fs.writeFile(REPORT_FILE, `${renderReport(snapshot)}\n`, 'utf-8');
}

async function main(): Promise<void> {
  const snapshot = await collectSnapshot();
  await persistSnapshot(snapshot);

  console.log(`D2 closure snapshot written to ${LATEST_FILE}`);
  console.log(`Decision: ${snapshot.decision}`);
  console.log(`Replay coverage: ${snapshot.replay.correlationCoverage.toFixed(3)}`);
  if (snapshot.failures.length > 0) {
    console.log(`Failure tokens: ${snapshot.failures.join(', ')}`);
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
      'Failed to collect D2 closure report:',
      error instanceof Error ? error.message : String(error)
    );
    process.exit(1);
  });
}
