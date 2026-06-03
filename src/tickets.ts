import fs from 'node:fs/promises';
import { TicketStoreRepository } from './task-store.js';
import { SelfAuditSeeder } from './self-audit.js';
import { computeBackendReliabilityMetrics, computeOperationalSLOMetrics, formatOperationalSLOMetrics } from './slo-metrics.js';
import { runTicketAutopilot } from './ticket-autopilot.js';
import { getTicketAutopilotRetryQuarantineReason } from './domain/scheduling/ticket-autopilot-policy.js';
import { exportPatchBundle } from './delivery.js';
import { exportCodexHandoffBundles } from './codex-handoff.js';
import { parseOption, parsePositiveInteger } from './cli-utils.js';
import { assessTicketTemplate, formatTicketTemplateAssessment } from './ticket-template.js';
import { computeSourceGroundingMetrics, formatSourceGroundingMetrics } from './source-grounding-metrics.js';
import { buildSourceGroundingDriftAudit } from './source-grounding-report.js';
import { deriveRecoveryRecommendation } from './recovery-recommendation.js';
import type { TaskAttempt, TaskStatus } from './types.js';

const validStatuses: TaskStatus[] = [
  'pending',
  'in_progress',
  'planned',
  'awaiting_approval',
  'applying',
  'verifying',
  'completed',
  'merged',
  'blocked',
  'failed',
  'stale',
  'cancelled',
  'superseded',
];

function printUsage(): void {
  console.log(`Hephaestus ticket CLI

Usage:
  npm run tickets -- create <description>
  npm run tickets -- list [--status <status>]
  npm run tickets -- show <ticket-id>
  npm run tickets -- retry <ticket-id> [--amend <description>]
  npm run tickets -- complete <ticket-id> [result]
  npm run tickets -- autopilot [--include-cancelled] [--no-retry-quarantine] [--no-self-audit] [--self-audit-limit <count>] [--max-attempts <count>] [--wave-size <count>] [--max-active <count>] [--min-completion-rate <ratio>] [--max-superseded-rate <ratio>] [--max-blocked <count>] [--blocked-window-days <days>] [--max-allowlist-denial-rate <ratio>] [--min-source-grounding-coverage <ratio>] [--min-source-evidence-coverage <ratio>] [--max-source-drifted <count>] [--max-source-snapshot-age-hours <hours>] [--enforce-d2] [--max-d2-count-mismatches <count>] [--max-d2-legacy-only <count>] [--max-d2-domain-only <count>] [--max-d2-domain-deficit <count>] [--max-d2-missing-legacy-link <count>] [--min-d2-replay-correlation-coverage <ratio>] [--dry-run]
  npm run tickets -- approve <ticket-id> <reviewer> [reason]
  npm run tickets -- reject <ticket-id> <reviewer> [reason]
  npm run tickets -- resume <ticket-id>
  npm run tickets -- cancel <ticket-id> [reason]
  npm run tickets -- supersede <ticket-id> [reason]
  npm run tickets -- export-bundle <ticket-id> [--out <directory>]
  npm run tickets -- codex-handoff [--status <status[,status...]>] [--out <directory>]
  npm run tickets -- attempts <ticket-id>
  npm run tickets -- timeline <ticket-id>
  npm run tickets -- evidence <ticket-id>
  npm run tickets -- gates <ticket-id>
  npm run tickets -- worker-versions <ticket-id>
  npm run tickets -- promotions <ticket-id>
  npm run tickets -- self-audit [--limit <count>] [--dry-run]
  npm run tickets -- metrics [--source-grounding]
  npm run tickets -- audit-source-evidence [--max-drifted <count>] [--max-missing-evidence <count>]
  npm run tickets -- verify-d2 [--max-count-mismatches <count>] [--max-legacy-only <count>] [--max-domain-only <count>] [--max-domain-deficit <count>] [--max-missing-legacy-link <count>] [--min-replay-correlation-coverage <ratio>]
  npm run tickets -- review-wave [--min-efficiency-score <score>] [--max-blocked <count>] [--blocked-window-days <days>] [--max-p95-ms <milliseconds>] [--max-allowlist-denial-rate <ratio>] [--min-backend-success-ratio <ratio>] [--min-source-grounding-coverage <ratio>] [--min-source-evidence-coverage <ratio>] [--max-source-drifted <count>] [--max-source-snapshot-age-hours <hours>] [--enforce-d2] [--max-d2-count-mismatches <count>] [--max-d2-legacy-only <count>] [--max-d2-domain-only <count>] [--max-d2-domain-deficit <count>] [--max-d2-missing-legacy-link <count>] [--min-d2-replay-correlation-coverage <ratio>]
  npm run tickets -- render-board
  npm run tickets -- sync-board

Statuses:
  ${validStatuses.join(', ')}
`);
}

function parseStatusArgument(value: string | undefined): TaskStatus | 'all' {
  if (!value || value === 'all') {
    return 'all';
  }

  if (!validStatuses.includes(value as TaskStatus)) {
    throw new Error(`Invalid status "${value}". Expected one of: all, ${validStatuses.join(', ')}`);
  }

  return value as TaskStatus;
}

function parseStatusesArgument(value: string | undefined): TaskStatus[] | undefined {
  if (!value) {
    return undefined;
  }

  const statuses = value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (statuses.length === 0) {
    return undefined;
  }

  for (const status of statuses) {
    if (!validStatuses.includes(status as TaskStatus)) {
      throw new Error(
        `Invalid status \"${status}\" in --status list. Expected one of: ${validStatuses.join(', ')}`
      );
    }
  }

  return statuses as TaskStatus[];
}

function formatTimestamp(value: Date | undefined): string {
  return value ? value.toISOString() : '-';
}

function normalizePath(pathValue: string): string {
  return String(pathValue || '').replace(/\\/g, '/').trim().toLowerCase();
}

function extractPolicySnapshots(attempts: TaskAttempt[]): Array<{
  raw: string;
  correlationId?: string;
  signature?: string;
  parsed?: Record<string, unknown>;
}> {
  const results: Array<{
    raw: string;
    correlationId?: string;
    signature?: string;
    parsed?: Record<string, unknown>;
  }> = [];

  for (const attempt of attempts) {
    for (const artifact of attempt.artifacts) {
      const match = artifact.match(/^\[(?<correlation>[^\]]+)\] policy\.snapshot \[(?<signature>[^\]]+)\] (?<payload>.+)$/);
      if (!match?.groups) {
        continue;
      }

      let parsed: Record<string, unknown> | undefined;
      try {
        parsed = JSON.parse(match.groups.payload) as Record<string, unknown>;
      } catch {
        parsed = undefined;
      }

      results.push({
        raw: artifact,
        correlationId: match.groups.correlation,
        signature: match.groups.signature,
        parsed,
      });
    }
  }

  return results;
}

function extractPatchDeltas(attempts: TaskAttempt[]): Array<{
  raw: string;
  correlationId?: string;
  subject: string;
  dryRun: string;
  apply: string;
  mutatedPaths: string[];
}> {
  const results: Array<{
    raw: string;
    correlationId?: string;
    subject: string;
    dryRun: string;
    apply: string;
    mutatedPaths: string[];
  }> = [];

  for (const attempt of attempts) {
    for (const artifact of attempt.artifacts) {
      const match = artifact.match(/^\[(?<correlation>[^\]]+)\] patch\.delta (?<subject>.+?): dry-run=(?<dryRun>[^;]+); apply=(?<apply>[^;]+); mutatedPaths=(?<paths>.*)$/);
      if (!match?.groups) {
        continue;
      }

      const mutatedPaths = match.groups.paths && match.groups.paths !== '-'
        ? match.groups.paths.split(',').map((value) => value.trim()).filter(Boolean)
        : [];

      results.push({
        raw: artifact,
        correlationId: match.groups.correlation,
        subject: match.groups.subject,
        dryRun: match.groups.dryRun,
        apply: match.groups.apply,
        mutatedPaths,
      });
    }
  }

  return results;
}

function parseRatioOption(value: string | undefined, name: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error(`${name} must be a number between 0 and 1.`);
  }

  return parsed;
}

function parseNumberOption(value: string | undefined, name: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be a finite number.`);
  }

  return parsed;
}

function parseNonNegativeIntegerOption(value: string | undefined, name: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }

  return parsed;
}

interface EfficiencyLatestSnapshot {
  efficiencyIndex?: {
    score?: number;
  };
  totals?: {
    blocked?: number;
  };
  latencyMs?: {
    admissionToComplete?: {
      p95?: number;
    };
  };
  policy?: {
    allowlistDenialRate?: number;
  };
}

interface SourceGroundingLatestSnapshot {
  timestamp?: string;
  groundingCoverage?: number;
  requiredTickets?: number;
  groundedTickets?: number;
  eventEvidence?: {
    auditableTickets?: number;
    ticketsWithEventEvidence?: number;
    eventEvidenceCoverage?: number;
    driftedTickets?: string[];
    missingEvidenceTickets?: string[];
  };
}

interface D2GateThresholds {
  maxCountMismatches: number;
  maxLegacyOnly: number;
  maxDomainOnly: number;
  maxDomainDeficit: number;
  maxMissingLegacyLink: number;
  minReplayCorrelationCoverage: number;
}

interface D2GateEvaluation {
  failures: string[];
  domainDeficit: number;
  missingLegacyLink: number;
  snapshot: Awaited<ReturnType<TicketStoreRepository['getD2EventSpineSnapshot']>>;
  replaySummary: Awaited<ReturnType<TicketStoreRepository['getD2ReplaySummary']>>;
}

async function evaluateD2Gate(
  repository: TicketStoreRepository,
  thresholds: D2GateThresholds
): Promise<D2GateEvaluation> {
  const snapshot = await repository.getD2EventSpineSnapshot();
  const replaySummaryA = await repository.getD2ReplaySummary();
  const replaySummaryB = await repository.getD2ReplaySummary();
  const failures: string[] = [];

  const domainDeficit = Math.max(0, snapshot.legacyEventCount - snapshot.domainEventCount);
  if (domainDeficit > thresholds.maxDomainDeficit) {
    failures.push(`d2-domain-deficit-high:${domainDeficit}>${thresholds.maxDomainDeficit}`);
  }
  if (snapshot.ticketsWithCountMismatch.length > thresholds.maxCountMismatches) {
    failures.push(
      `d2-count-mismatch-high:${snapshot.ticketsWithCountMismatch.length}>${thresholds.maxCountMismatches}`
    );
  }
  if (snapshot.ticketsWithLegacyOnly.length > thresholds.maxLegacyOnly) {
    failures.push(`d2-legacy-only-high:${snapshot.ticketsWithLegacyOnly.length}>${thresholds.maxLegacyOnly}`);
  }
  if (snapshot.ticketsWithDomainOnly.length > thresholds.maxDomainOnly) {
    failures.push(`d2-domain-only-high:${snapshot.ticketsWithDomainOnly.length}>${thresholds.maxDomainOnly}`);
  }

  const missingLegacyLink = Math.max(0, snapshot.domainEventCount - snapshot.domainEventsWithLegacyLink);
  if (missingLegacyLink > thresholds.maxMissingLegacyLink) {
    failures.push(`d2-missing-legacy-link-high:${missingLegacyLink}>${thresholds.maxMissingLegacyLink}`);
  }
  if (replaySummaryA.replayHash !== replaySummaryB.replayHash) {
    failures.push('d2-replay-hash-unstable');
  }
  if (replaySummaryA.totalEvents === 0) {
    failures.push('d2-replay-empty');
  }
  if (replaySummaryA.correlationCoverage < thresholds.minReplayCorrelationCoverage) {
    failures.push(
      `d2-replay-correlation-low:${replaySummaryA.correlationCoverage.toFixed(3)}<${thresholds.minReplayCorrelationCoverage}`
    );
  }

  return {
    failures,
    domainDeficit,
    missingLegacyLink,
    snapshot,
    replaySummary: replaySummaryA,
  };
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    printUsage();
    return;
  }

  const repository = new TicketStoreRepository();

  try {
    switch (command) {
      case 'create': {
        const description = args.join(' ').trim();
        if (!description) {
          throw new Error('create requires a non-empty ticket description.');
        }

        const templateAssessment = assessTicketTemplate(description);
        if (!templateAssessment.valid) {
          throw new Error(formatTicketTemplateAssessment(templateAssessment));
        }

        const ticket = await repository.createTicket(description);
        console.log(`Created ${ticket.id} [${ticket.status}] ${ticket.description}`);
        break;
      }

      case 'list': {
        const status = parseStatusArgument(parseOption(args, '--status'));
        const tickets = await repository.listTickets(status);
        if (tickets.length === 0) {
          console.log('No tickets found.');
          break;
        }

        for (const ticket of tickets) {
          console.log(
            `${ticket.id}\t${ticket.status}\tattempts=${ticket.attemptCount}\t${ticket.description}`
          );
        }
        break;
      }

      case 'show': {
        const ticketId = args[0];
        if (!ticketId) {
          throw new Error('show requires a ticket id.');
        }

        const ticket = await repository.getTicket(ticketId);
        if (!ticket) {
          throw new Error(`Ticket not found: ${ticketId}`);
        }

        console.log(`ID: ${ticket.id}`);
        console.log(`Status: ${ticket.status}`);
        console.log(`Description: ${ticket.description}`);
        console.log(`Attempts: ${ticket.attemptCount}`);
        console.log(`Created: ${formatTimestamp(ticket.createdAt)}`);
        console.log(`Updated: ${formatTimestamp(ticket.updatedAt)}`);
        console.log(`Started: ${formatTimestamp(ticket.startedAt)}`);
        console.log(`Completed: ${formatTimestamp(ticket.completedAt)}`);
        console.log(`Blocked: ${formatTimestamp(ticket.blockedAt)}`);
        if (ticket.error) {
          console.log(`Error: ${ticket.error}`);
        }
        if (ticket.result) {
          console.log(`Result: ${ticket.result}`);
        }
        if (ticket.plan) {
          console.log(`Plan Summary: ${ticket.plan.summary}`);
        }
        if (ticket.toolCalls?.length) {
          console.log(`Pending Tool Calls: ${ticket.toolCalls.length}`);
        }
        if (ticket.approval) {
          console.log(`Approval Status: ${ticket.approval.status}`);
          console.log(`Approval Requested: ${formatTimestamp(ticket.approval.requestedAt)}`);
          if (ticket.approval.reviewer) {
            console.log(`Approval Reviewer: ${ticket.approval.reviewer}`);
          }
          if (ticket.approval.rationale) {
            console.log(`Approval Rationale: ${ticket.approval.rationale}`);
          }
          if (ticket.approval.approvalId) {
            console.log(`Approval Token: ${ticket.approval.approvalId}`);
          }
        }

        const events = await repository.listEvents(ticket.id);
        if (events.length > 0) {
          console.log('Events:');
          for (const event of events) {
            const details = event.details ? ` - ${event.details}` : '';
            console.log(`  ${event.createdAt.toISOString()} ${event.type}${details}`);
          }
        }

        const attempts = await repository.listAttempts(ticket.id);
        if (attempts.length > 0) {
          console.log('Attempts:');
          for (const attempt of attempts) {
            const endedAt = attempt.endedAt ? attempt.endedAt.toISOString() : '-';
            console.log(
              `  #${attempt.attemptNumber} ${attempt.id} ${attempt.status} ${attempt.startedAt.toISOString()} -> ${endedAt}`
            );
          }
        }
        break;
      }

      case 'retry': {
        const ticketId = args[0];
        if (!ticketId) {
          throw new Error('retry requires a ticket id.');
        }

        const amendedDescription = parseOption(args, '--amend');
        if (amendedDescription) {
          const templateAssessment = assessTicketTemplate(amendedDescription);
          if (!templateAssessment.valid) {
            throw new Error(formatTicketTemplateAssessment(templateAssessment));
          }
        }

        const ticket = await repository.retryTicket(ticketId, { amendedDescription });
        console.log(`Retried ${ticket.id}; new status: ${ticket.status}`);
        if (amendedDescription) {
          console.log(`Amended description: ${ticket.description}`);
        }
        break;
      }

      case 'complete': {
        const ticketId = args[0];
        if (!ticketId) {
          throw new Error('complete requires a ticket id.');
        }

        const result = args.slice(1).join(' ').trim() || undefined;
        const ticket = await repository.completeTicket(ticketId, result);
        console.log(`Completed ${ticket.id}; new status: ${ticket.status}`);
        if (ticket.result) {
          console.log(`Result: ${ticket.result}`);
        }
        break;
      }

      case 'autopilot': {
        const includeCancelled = args.includes('--include-cancelled');
        const disableRetryQuarantine = args.includes('--no-retry-quarantine');
        const seedSelfAuditWhenIdle = !args.includes('--no-self-audit');
        const dryRun = args.includes('--dry-run');
        const selfAuditLimit = parsePositiveInteger(
          parseOption(args, '--self-audit-limit'),
          '--self-audit-limit'
        );
        const maxAttempts = parsePositiveInteger(parseOption(args, '--max-attempts'), '--max-attempts');
        const waveSize = parsePositiveInteger(parseOption(args, '--wave-size'), '--wave-size');
        const maxActiveTickets = parsePositiveInteger(parseOption(args, '--max-active'), '--max-active');
        const maxBlockedTickets = parsePositiveInteger(parseOption(args, '--max-blocked'), '--max-blocked');
        const blockedWindowDays = parsePositiveInteger(
          parseOption(args, '--blocked-window-days'),
          '--blocked-window-days'
        );
        const minCompletionRate = parseRatioOption(parseOption(args, '--min-completion-rate'), '--min-completion-rate');
        const maxSupersededRate = parseRatioOption(parseOption(args, '--max-superseded-rate'), '--max-superseded-rate');
        const maxAllowlistDenialRate = parseRatioOption(parseOption(args, '--max-allowlist-denial-rate'), '--max-allowlist-denial-rate');
        const minSourceGroundingCoverage = parseRatioOption(
          parseOption(args, '--min-source-grounding-coverage'),
          '--min-source-grounding-coverage'
        );
        const minSourceEvidenceCoverage = parseRatioOption(
          parseOption(args, '--min-source-evidence-coverage'),
          '--min-source-evidence-coverage'
        );
        const maxSourceDriftedTickets = parseNonNegativeIntegerOption(
          parseOption(args, '--max-source-drifted'),
          '--max-source-drifted'
        );
        const maxSourceSnapshotAgeHours = parseNumberOption(
          parseOption(args, '--max-source-snapshot-age-hours'),
          '--max-source-snapshot-age-hours'
        );
        const enforceD2 = args.includes('--enforce-d2');
        const maxD2CountMismatches = parseNonNegativeIntegerOption(
          parseOption(args, '--max-d2-count-mismatches'),
          '--max-d2-count-mismatches'
        ) ?? 0;
        const maxD2LegacyOnly = parseNonNegativeIntegerOption(
          parseOption(args, '--max-d2-legacy-only'),
          '--max-d2-legacy-only'
        ) ?? 0;
        const maxD2DomainOnly = parseNonNegativeIntegerOption(
          parseOption(args, '--max-d2-domain-only'),
          '--max-d2-domain-only'
        ) ?? 0;
        const maxD2DomainDeficit = parseNonNegativeIntegerOption(
          parseOption(args, '--max-d2-domain-deficit'),
          '--max-d2-domain-deficit'
        ) ?? 0;
        const maxD2MissingLegacyLink = parseNonNegativeIntegerOption(
          parseOption(args, '--max-d2-missing-legacy-link'),
          '--max-d2-missing-legacy-link'
        ) ?? 0;
        const minD2ReplayCorrelationCoverage = parseRatioOption(
          parseOption(args, '--min-d2-replay-correlation-coverage'),
          '--min-d2-replay-correlation-coverage'
        ) ?? 0.2;
        const enforceSourceSnapshot =
          minSourceGroundingCoverage !== undefined ||
          minSourceEvidenceCoverage !== undefined ||
          maxSourceDriftedTickets !== undefined ||
          maxSourceSnapshotAgeHours !== undefined;

        let sourceGroundingSnapshot: SourceGroundingLatestSnapshot | undefined;
        try {
          const sourceGroundingRaw = await fs.readFile('docs/metrics/source-grounding-latest.json', 'utf-8');
          sourceGroundingSnapshot = JSON.parse(sourceGroundingRaw) as SourceGroundingLatestSnapshot;
        } catch {
          sourceGroundingSnapshot = undefined;
        }

        let d2Evaluation: D2GateEvaluation | undefined;
        if (enforceD2) {
          d2Evaluation = await evaluateD2Gate(repository, {
            maxCountMismatches: maxD2CountMismatches,
            maxLegacyOnly: maxD2LegacyOnly,
            maxDomainOnly: maxD2DomainOnly,
            maxDomainDeficit: maxD2DomainDeficit,
            maxMissingLegacyLink: maxD2MissingLegacyLink,
            minReplayCorrelationCoverage: minD2ReplayCorrelationCoverage,
          });
        }

        const result = await runTicketAutopilot(
          {
            repository,
            selfAuditSeeder: new SelfAuditSeeder({ repository }),
          },
          {
            includeCancelled,
            disableRetryQuarantine,
            dryRun,
            seedSelfAuditWhenIdle,
            selfAuditLimit,
            maxAttempts,
            waveSize,
            maxActiveTickets,
            maxBlockedTickets,
            blockedWindowDays,
            minCompletionRate,
            maxSupersededRate,
            maxAllowlistDenialRate,
            minSourceGroundingCoverage,
            minSourceEvidenceCoverage,
            maxSourceDriftedTickets,
            sourceGroundingSnapshot,
            enforceSourceSnapshot,
            maxSourceSnapshotAgeHours,
            additionalGateFailures: d2Evaluation?.failures,
          }
        );

        console.log(`Existing runnable tickets: ${result.runnableTicketCount}`);
        console.log(`Awaiting approval tickets: ${result.awaitingApprovalCount}`);
        console.log(`Active tickets: ${result.activeTicketCount}`);
        console.log(`Wave slots available: ${result.availableWaveSlots}`);

        if (result.blockedByGates) {
          console.log('Autopilot paused by efficiency gates:');
          for (const failure of result.gateFailures) {
            console.log(`Gate fail ${failure}`);
          }
        }

        if (d2Evaluation) {
          console.log(
            `D2 replay coverage: ${d2Evaluation.replaySummary.correlationCoverage.toFixed(3)} (threshold ${minD2ReplayCorrelationCoverage})`
          );
          console.log(`D2 replay hash: ${d2Evaluation.replaySummary.replayHash}`);
          console.log(
            `D2 count mismatch tickets: ${d2Evaluation.snapshot.ticketsWithCountMismatch.length} (threshold ${maxD2CountMismatches})`
          );
          console.log(`D2 domain deficit: ${d2Evaluation.domainDeficit} (threshold ${maxD2DomainDeficit})`);
          console.log(
            `D2 missing legacy link rows: ${d2Evaluation.missingLegacyLink} (threshold ${maxD2MissingLegacyLink})`
          );
        }

        for (const ticket of result.resumed) {
          console.log(`${dryRun ? 'Would resume' : 'Resumed'} ${ticket.id} ${ticket.description}`);
        }

        for (const ticket of result.requeued) {
          console.log(`${dryRun ? 'Would requeue' : 'Requeued'} ${ticket.id} ${ticket.description}`);
        }

        for (const ticket of result.quarantinedRetryTickets) {
          const reason = getTicketAutopilotRetryQuarantineReason(ticket) ?? 'unknown';
          console.log(
            `Quarantined retry ${ticket.id} reason=${reason} attempts=${ticket.attemptCount} ${ticket.description}`
          );
        }

        for (const ticket of result.skippedRetryCap) {
          console.log(`Skipped retry cap ${ticket.id} attempts=${ticket.attemptCount} ${ticket.description}`);
        }

        if (result.selfAudit) {
          console.log(result.selfAudit.summary);
          console.log(`Findings: ${result.selfAudit.findings.length}`);

          for (const created of result.selfAudit.created) {
            console.log(`${dryRun ? 'Preview' : 'Created'} ${created.id} ${created.description}`);
          }

          for (const skipped of result.selfAudit.skippedDuplicates) {
            console.log(`Skipped duplicate ${skipped}`);
          }
        }

        if (result.blockedByGates) {
          console.log('Autopilot halted queue priming; run remediation tickets before admitting new waves.');
        } else if (result.queueReady) {
          console.log(
            dryRun
              ? 'Autopilot would leave runnable work in the queue. If the daemon is already running, it would begin processing automatically.'
              : 'Autopilot primed the queue. If the daemon is already running, it will begin processing automatically.'
          );
        } else if (result.awaitingApprovalCount > 0) {
          console.log('Autopilot found tickets waiting on operator approval. Resume or approve them before expecting automatic execution.');
        } else if (seedSelfAuditWhenIdle) {
          console.log('Autopilot found no runnable work to queue.');
        } else {
          console.log('Autopilot finished without creating runnable work.');
        }

        break;
      }

      case 'approve': {
        const ticketId = args[0];
        const reviewer = args[1];
        if (!ticketId || !reviewer) {
          throw new Error('approve requires a ticket id and reviewer.');
        }

        const rationale = args.slice(2).join(' ').trim() || 'Approved by operator.';
        const ticket = await repository.approveTicket(ticketId, reviewer, rationale);
        console.log(`Approved ${ticket.id}; approval status: ${ticket.approval?.status ?? 'unknown'}`);
        break;
      }

      case 'reject': {
        const ticketId = args[0];
        const reviewer = args[1];
        if (!ticketId || !reviewer) {
          throw new Error('reject requires a ticket id and reviewer.');
        }

        const rationale = args.slice(2).join(' ').trim() || 'Rejected by operator.';
        const ticket = await repository.rejectTicket(ticketId, reviewer, rationale);
        console.log(`Rejected ${ticket.id}; new status: ${ticket.status}`);
        break;
      }

      case 'resume': {
        const ticketId = args[0];
        if (!ticketId) {
          throw new Error('resume requires a ticket id.');
        }

        const ticket = await repository.resumeApprovedTicket(ticketId);
        console.log(`Resumed ${ticket.id}; new status: ${ticket.status}`);
        break;
      }

      case 'cancel': {
        const ticketId = args[0];
        if (!ticketId) {
          throw new Error('cancel requires a ticket id.');
        }

        const reason = args.slice(1).join(' ').trim() || undefined;
        const ticket = await repository.cancelTicket(ticketId, reason);
        console.log(`Cancelled ${ticket.id}; new status: ${ticket.status}`);
        break;
      }

      case 'supersede': {
        const ticketId = args[0];
        if (!ticketId) {
          throw new Error('supersede requires a ticket id.');
        }

        const reason = args.slice(1).join(' ').trim() || undefined;
        const ticket = await repository.supersedeTicket(ticketId, reason);
        console.log(`Superseded ${ticket.id}; new status: ${ticket.status}`);
        break;
      }

      case 'export-bundle': {
        const ticketId = args[0];
        if (!ticketId) {
          throw new Error('export-bundle requires a ticket id.');
        }

        const bundle = await exportPatchBundle(repository, ticketId, {
          outputRoot: parseOption(args, '--out'),
        });
        console.log(`Exported ${bundle.patchCount} patch(es) for ${ticketId}`);
        console.log(`Bundle: ${bundle.outputDir}`);
        console.log(`Patch: ${bundle.patchFile}`);
        console.log(`Manifest: ${bundle.manifestFile}`);
        break;
      }

      case 'codex-handoff': {
        const statuses = parseStatusesArgument(parseOption(args, '--status'));
        const exported = await exportCodexHandoffBundles(repository, {
          outputRoot: parseOption(args, '--out'),
          statuses,
        });

        if (exported.length === 0) {
          console.log('No eligible active tickets found for codex handoff export.');
          break;
        }

        for (const bundle of exported) {
          console.log(`${bundle.ticketId}\t${bundle.lane}\t${bundle.outputFile}`);
        }
        console.log(`Exported ${exported.length} codex handoff bundle(s).`);
        break;
      }

      case 'attempts': {
        const ticketId = args[0];
        if (!ticketId) {
          throw new Error('attempts requires a ticket id.');
        }

        const attempts = await repository.listAttempts(ticketId);
        if (attempts.length === 0) {
          console.log('No attempts found.');
          break;
        }

        for (const attempt of attempts) {
          const endedAt = attempt.endedAt ? attempt.endedAt.toISOString() : '-';
          console.log(
            `${attempt.id}\t#${attempt.attemptNumber}\t${attempt.status}\t${attempt.startedAt.toISOString()}\t${endedAt}`
          );
        }
        break;
      }

      case 'timeline': {
        const ticketId = args[0];
        if (!ticketId) {
          throw new Error('timeline requires a ticket id.');
        }

        const attempts = await repository.listAttempts(ticketId);
        const events = await repository.listEvents(ticketId);
        const attemptIds = new Set(attempts.map((attempt) => attempt.id));
        const workerVersions = (await repository.listWorkerVersions())
          .filter((workerVersion) => attemptIds.has(workerVersion.attemptId));
        const workerVersionById = new Map(workerVersions.map((workerVersion) => [workerVersion.id, workerVersion]));
        const workerVersionIds = new Set(workerVersions.map((workerVersion) => workerVersion.id));
        const promotions = (await repository.listPromotionRecords())
          .filter((promotion) => workerVersionIds.has(promotion.workerVersionId));

        const timelineEntries: Array<{ at: Date; source: string; detail: string }> = [];

        for (const event of events) {
          timelineEntries.push({
            at: event.createdAt,
            source: `event.${event.type}`,
            detail: event.details ?? '-',
          });
        }

        for (const attempt of attempts) {
          timelineEntries.push({
            at: attempt.startedAt,
            source: 'attempt.started',
            detail: `${attempt.id} #${attempt.attemptNumber}`,
          });
          if (attempt.endedAt) {
            timelineEntries.push({
              at: attempt.endedAt,
              source: 'attempt.ended',
              detail: `${attempt.id} status=${attempt.status}`,
            });
          }
        }

        for (const workerVersion of workerVersions) {
          timelineEntries.push({
            at: workerVersion.createdAt,
            source: 'worker-version.created',
            detail: `${workerVersion.id} attempt=${workerVersion.attemptId} status=${workerVersion.status}`,
          });
          if (workerVersion.activatedAt) {
            timelineEntries.push({
              at: workerVersion.activatedAt,
              source: 'worker-version.activated',
              detail: `${workerVersion.id} status=${workerVersion.status}`,
            });
          }
        }

        for (const promotion of promotions) {
          const workerVersion = workerVersionById.get(promotion.workerVersionId);
          timelineEntries.push({
            at: promotion.requestedAt,
            source: 'promotion.requested',
            detail: `${promotion.id} worker=${promotion.workerVersionId} status=${promotion.status}`,
          });
          timelineEntries.push({
            at: promotion.updatedAt,
            source: 'promotion.updated',
            detail: `${promotion.id} worker=${promotion.workerVersionId} version=${workerVersion?.status ?? '-'} status=${promotion.status}`,
          });
        }

        timelineEntries.sort((left, right) => left.at.getTime() - right.at.getTime());

        console.log(`Ticket: ${ticketId}`);
        console.log(`Timeline entries: ${timelineEntries.length}`);
        for (const entry of timelineEntries) {
          console.log(`${entry.at.toISOString()}\t${entry.source}\t${entry.detail}`);
        }
        break;
      }

      case 'evidence': {
        const ticketId = args[0];
        if (!ticketId) {
          throw new Error('evidence requires a ticket id.');
        }

        const attempts = await repository.listAttempts(ticketId);
        if (attempts.length === 0) {
          console.log('No attempts found for ticket.');
          break;
        }

        const policySnapshots = extractPolicySnapshots(attempts);
        const patchDeltas = extractPatchDeltas(attempts);

        console.log(`Ticket: ${ticketId}`);
        console.log(`Attempts: ${attempts.length}`);
        console.log(`Policy snapshots: ${policySnapshots.length}`);
        for (const snapshot of policySnapshots) {
          const parsed = snapshot.parsed ? JSON.stringify(snapshot.parsed) : '-';
          console.log(`${snapshot.signature ?? '-'}\tcorr=${snapshot.correlationId ?? '-'}\t${parsed}`);
        }

        console.log(`Patch deltas: ${patchDeltas.length}`);
        for (const delta of patchDeltas) {
          console.log(
            `${delta.subject}\tcorr=${delta.correlationId ?? '-'}\tdry-run=${delta.dryRun}\tapply=${delta.apply}\tmutatedPaths=${delta.mutatedPaths.join(',') || '-'}`
          );
        }

        const events = await repository.listEvents(ticketId);
        if (events.length > 0) {
          console.log(`Events: ${events.length}`);
          for (const event of events) {
            console.log(`${event.createdAt.toISOString()}\t${event.type}\t${event.details ?? '-'}`);
          }
        }
        break;
      }

      case 'gates': {
        const ticketId = args[0];
        if (!ticketId) {
          throw new Error('gates requires a ticket id.');
        }

        const ticket = await repository.getTicket(ticketId);
        if (!ticket) {
          throw new Error(`Ticket not found: ${ticketId}`);
        }

        const attempts = await repository.listAttempts(ticketId);
        const patchDeltas = extractPatchDeltas(attempts);
        const intendedFiles = Array.isArray(ticket.plan?.intendedFiles)
          ? ticket.plan.intendedFiles
          : [];
        const mutableTargets = intendedFiles
          .filter((file) => file && file.changeType !== 'inspect' && typeof file.path === 'string')
          .map((file) => file.path);

        const observedMutations: string[] = [];
        for (const delta of patchDeltas) {
          const applyState = String(delta.apply ?? '').toLowerCase();
          if (!applyState.startsWith('success')) {
            continue;
          }

          for (const pathValue of delta.mutatedPaths) {
            if (!observedMutations.includes(pathValue)) {
              observedMutations.push(pathValue);
            }
          }
        }

        const normalizedObserved = observedMutations.map((value) => normalizePath(value));
        const hasTargetIntersection = mutableTargets
          .map((value) => normalizePath(value))
          .some((candidate) => normalizedObserved.includes(candidate));
        const errorText = typeof ticket.error === 'string' ? ticket.error : '';
        const failedEvidenceGate = /No governed mutation evidence|do not intersect mutable intended files|Completion requires/i.test(errorText);

        let gateStatus = 'pending evidence';
        if (mutableTargets.length === 0) {
          gateStatus = 'no mutable targets';
        } else if (failedEvidenceGate) {
          gateStatus = 'failed evidence gate';
        } else if (hasTargetIntersection) {
          gateStatus = 'mutation evidence present';
        } else if (ticket.status === 'completed') {
          gateStatus = 'completed without visible mutation evidence';
        }

        const recoveryRecommendation = deriveRecoveryRecommendation(ticket, attempts);

        console.log(`Ticket: ${ticketId}`);
        console.log(`Gate Status: ${gateStatus}`);
        console.log(`Mutable Targets: ${mutableTargets.join(', ') || '-'}`);
        console.log(`Observed Mutations: ${observedMutations.join(', ') || '-'}`);
        console.log(`Gate Reason: ${failedEvidenceGate ? errorText : '-'}`);
        console.log(`Recovery Family: ${recoveryRecommendation.family || '-'}`);
        console.log(`Recovery Source: ${recoveryRecommendation.source || '-'}`);
        console.log(`Recovery Recommendation: ${recoveryRecommendation.recommendation || '-'}`);
        break;
      }

      case 'worker-versions': {
        const ticketId = args[0];
        if (!ticketId) {
          throw new Error('worker-versions requires a ticket id.');
        }

        const attempts = await repository.listAttempts(ticketId);
        if (attempts.length === 0) {
          console.log('No attempts found for ticket.');
          break;
        }

        const attemptsById = new Map(attempts.map((attempt) => [attempt.id, attempt]));
        const attemptIds = new Set(attempts.map((attempt) => attempt.id));
        const workerVersions = (await repository.listWorkerVersions())
          .filter((workerVersion) => attemptIds.has(workerVersion.attemptId));

        if (workerVersions.length === 0) {
          console.log('No worker versions found.');
          break;
        }

        for (const workerVersion of workerVersions) {
          const attempt = attemptsById.get(workerVersion.attemptId);
          const workspaceParts = [
            workerVersion.workspaceId ? `workspace=${workerVersion.workspaceId}` : null,
            workerVersion.workspaceRoot ? `root=${workerVersion.workspaceRoot}` : null,
            workerVersion.patchBundlePath ? `bundle=${workerVersion.patchBundlePath}` : null,
          ].filter(Boolean);
          console.log(
            `${workerVersion.id}\tattempt=${workerVersion.attemptId} #${attempt?.attemptNumber ?? '-'}\t${workerVersion.status}\t${workspaceParts.join('\t')}\tcreated=${workerVersion.createdAt.toISOString()}\tactivated=${formatTimestamp(workerVersion.activatedAt)}`
          );
        }
        break;
      }

      case 'promotions': {
        const ticketId = args[0];
        if (!ticketId) {
          throw new Error('promotions requires a ticket id.');
        }

        const attempts = await repository.listAttempts(ticketId);
        if (attempts.length === 0) {
          console.log('No attempts found for ticket.');
          break;
        }

        const attemptIds = new Set(attempts.map((attempt) => attempt.id));
        const attemptsById = new Map(attempts.map((attempt) => [attempt.id, attempt]));
        const workerVersions = (await repository.listWorkerVersions())
          .filter((workerVersion) => attemptIds.has(workerVersion.attemptId));
        const workerVersionIds = new Set(workerVersions.map((workerVersion) => workerVersion.id));
        const workerVersionById = new Map(workerVersions.map((workerVersion) => [workerVersion.id, workerVersion]));

        const promotions = (await repository.listPromotionRecords())
          .filter((promotion) => workerVersionIds.has(promotion.workerVersionId));

        if (promotions.length === 0) {
          console.log('No promotion records found.');
          break;
        }

        for (const promotion of promotions) {
          const workerVersion = workerVersionById.get(promotion.workerVersionId);
          const attempt = workerVersion ? attemptsById.get(workerVersion.attemptId) : undefined;
          const promotionParts = [
            attempt ? `attempt=${attempt.attemptNumber}` : null,
            workerVersion?.workspaceId ? `workspace=${workerVersion.workspaceId}` : null,
            workerVersion?.workspaceRoot ? `root=${workerVersion.workspaceRoot}` : null,
            workerVersion?.status ? `version=${workerVersion.status}` : null,
          ].filter(Boolean);
          console.log(
            `${promotion.id}\tworker=${promotion.workerVersionId}\t${promotion.status}\t${promotionParts.join('\t')}\trequested=${promotion.requestedAt.toISOString()}\tupdated=${promotion.updatedAt.toISOString()}\tfailure=${promotion.failureReason ?? '-'}\trollback=${promotion.rollbackReason ?? '-'}`
          );
        }
        break;
      }

      case 'self-audit': {
        const limit = parsePositiveInteger(parseOption(args, '--limit'), '--limit');
        const dryRun = args.includes('--dry-run');
        const seeder = new SelfAuditSeeder({ repository });
        const result = await seeder.seedTickets({ limit, dryRun });
        console.log(result.summary);
        console.log(`Findings: ${result.findings.length}`);
        if (result.skippedBecauseQueueActive) {
          console.log('Skipped: active tickets already exist.');
          break;
        }
        for (const created of result.created) {
          const prefix = dryRun ? 'Preview' : 'Created';
          console.log(`${prefix} ${created.id} ${created.description}`);
        }
        for (const skipped of result.skippedDuplicates) {
          console.log(`Skipped duplicate ${skipped}`);
        }
        break;
      }

      case 'metrics': {
        const tickets = await repository.listTickets('all');
        const attemptsByTicket = await repository.listAttemptsForTickets(tickets.map((ticket) => ticket.id));
        const lastBoardSyncAt = await repository.getLatestEventTimestamp('board-synced');
        const metrics = computeOperationalSLOMetrics({ tickets, attemptsByTicket, lastBoardSyncAt });
        console.log(formatOperationalSLOMetrics(metrics));
        if (args.includes('--source-grounding')) {
          const groundingMetrics = computeSourceGroundingMetrics(tickets);
          console.log('');
          console.log(formatSourceGroundingMetrics(groundingMetrics));
        }
        break;
      }

      case 'audit-source-evidence': {
        const maxDrifted = parseNonNegativeIntegerOption(
          parseOption(args, '--max-drifted'),
          '--max-drifted'
        ) ?? 0;
        const maxMissingEvidence = parseNonNegativeIntegerOption(
          parseOption(args, '--max-missing-evidence'),
          '--max-missing-evidence'
        ) ?? 0;

        const tickets = await repository.listTickets('all');
        const events = await repository.listEvents();
        const audit = buildSourceGroundingDriftAudit(tickets, events);

        const failures: string[] = [];
        if (audit.driftedTickets.length > maxDrifted) {
          failures.push(`drifted-tickets-high:${audit.driftedTickets.length}>${maxDrifted}`);
        }
        if (audit.missingEvidenceTickets.length > maxMissingEvidence) {
          failures.push(
            `missing-evidence-tickets-high:${audit.missingEvidenceTickets.length}>${maxMissingEvidence}`
          );
        }

        console.log('Hephaestus source evidence audit');
        console.log(`Decision: ${failures.length === 0 ? 'PASS' : 'FAIL'}`);
        console.log(`Auditable tickets: ${audit.auditableTickets}`);
        console.log(`Tickets with event evidence: ${audit.ticketsWithEventEvidence}`);
        console.log(`Event evidence coverage: ${audit.eventEvidenceCoverage.toFixed(3)}`);
        console.log(`Drifted tickets: ${audit.driftedTickets.length} (threshold ${maxDrifted})`);
        console.log(
          `Missing evidence tickets: ${audit.missingEvidenceTickets.length} (threshold ${maxMissingEvidence})`
        );

        if (audit.driftedTickets.length > 0) {
          console.log(`Drifted ticket IDs: ${audit.driftedTickets.join(', ')}`);
        }
        if (audit.missingEvidenceTickets.length > 0) {
          console.log(`Missing evidence ticket IDs: ${audit.missingEvidenceTickets.join(', ')}`);
        }

        if (failures.length > 0) {
          throw new Error(`source evidence audit failed: ${failures.join(', ')}`);
        }
        break;
      }

      case 'verify-d2': {
        const maxCountMismatches = parseNonNegativeIntegerOption(
          parseOption(args, '--max-count-mismatches'),
          '--max-count-mismatches'
        ) ?? 0;
        const maxLegacyOnly = parseNonNegativeIntegerOption(
          parseOption(args, '--max-legacy-only'),
          '--max-legacy-only'
        ) ?? 0;
        const maxDomainOnly = parseNonNegativeIntegerOption(
          parseOption(args, '--max-domain-only'),
          '--max-domain-only'
        ) ?? 0;
        const maxDomainDeficit = parseNonNegativeIntegerOption(
          parseOption(args, '--max-domain-deficit'),
          '--max-domain-deficit'
        ) ?? 0;
        const maxMissingLegacyLink = parseNonNegativeIntegerOption(
          parseOption(args, '--max-missing-legacy-link'),
          '--max-missing-legacy-link'
        ) ?? 0;
        const minReplayCorrelationCoverage = parseRatioOption(
          parseOption(args, '--min-replay-correlation-coverage'),
          '--min-replay-correlation-coverage'
        ) ?? 0;

        const evaluation = await evaluateD2Gate(repository, {
          maxCountMismatches,
          maxLegacyOnly,
          maxDomainOnly,
          maxDomainDeficit,
          maxMissingLegacyLink,
          minReplayCorrelationCoverage,
        });
        const { failures, domainDeficit, missingLegacyLink, snapshot, replaySummary } = evaluation;

        console.log('Hephaestus D2 verifier');
        console.log(`Decision: ${failures.length === 0 ? 'PASS' : 'FAIL'}`);
        console.log(`Legacy events: ${snapshot.legacyEventCount}`);
        console.log(`Domain events: ${snapshot.domainEventCount}`);
        console.log(`Domain event deficit: ${domainDeficit} (threshold ${maxDomainDeficit})`);
        console.log(`Domain events with legacy link: ${snapshot.domainEventsWithLegacyLink}`);
        console.log(`Missing legacy link rows: ${missingLegacyLink} (threshold ${maxMissingLegacyLink})`);
        console.log(`Event evidence rows: ${snapshot.eventEvidenceCount}`);
        console.log(`Replay tickets: ${replaySummary.ticketCount}`);
        console.log(`Replay total events: ${replaySummary.totalEvents}`);
        console.log(
          `Replay correlation coverage: ${replaySummary.correlationCoverage.toFixed(3)} (threshold ${minReplayCorrelationCoverage})`
        );
        console.log(`Replay hash: ${replaySummary.replayHash}`);
        console.log(
          `Tickets with event count mismatch: ${snapshot.ticketsWithCountMismatch.length} (threshold ${maxCountMismatches})`
        );
        console.log(
          `Tickets with legacy only events: ${snapshot.ticketsWithLegacyOnly.length} (threshold ${maxLegacyOnly})`
        );
        console.log(
          `Tickets with domain only events: ${snapshot.ticketsWithDomainOnly.length} (threshold ${maxDomainOnly})`
        );

        if (snapshot.ticketsWithCountMismatch.length > 0) {
          console.log(`Count mismatch ticket IDs: ${snapshot.ticketsWithCountMismatch.slice(0, 20).join(', ')}`);
        }
        if (snapshot.ticketsWithLegacyOnly.length > 0) {
          console.log(`Legacy-only ticket IDs: ${snapshot.ticketsWithLegacyOnly.slice(0, 20).join(', ')}`);
        }
        if (snapshot.ticketsWithDomainOnly.length > 0) {
          console.log(`Domain-only ticket IDs: ${snapshot.ticketsWithDomainOnly.slice(0, 20).join(', ')}`);
        }

        if (failures.length > 0) {
          throw new Error(`d2-verifier-failed: ${failures.join(', ')}`);
        }
        break;
      }

      case 'review-wave': {
        const minEfficiencyScore = parseNumberOption(parseOption(args, '--min-efficiency-score'), '--min-efficiency-score') ?? 70;
        const maxBlockedTickets = parsePositiveInteger(parseOption(args, '--max-blocked'), '--max-blocked') ?? 20;
        const blockedWindowDays = parsePositiveInteger(
          parseOption(args, '--blocked-window-days'),
          '--blocked-window-days'
        );
        const maxP95AdmissionToCompleteMs = parseNumberOption(parseOption(args, '--max-p95-ms'), '--max-p95-ms') ?? 5_500_000;
        const maxAllowlistDenialRate = parseRatioOption(parseOption(args, '--max-allowlist-denial-rate'), '--max-allowlist-denial-rate') ?? 0.08;
        const minBackendSuccessRatio = parseRatioOption(parseOption(args, '--min-backend-success-ratio'), '--min-backend-success-ratio') ?? 0.7;
        const minSourceGroundingCoverage = parseRatioOption(
          parseOption(args, '--min-source-grounding-coverage'),
          '--min-source-grounding-coverage'
        ) ?? 0.9;
        const minSourceEvidenceCoverage = parseRatioOption(
          parseOption(args, '--min-source-evidence-coverage'),
          '--min-source-evidence-coverage'
        ) ?? 0.95;
        const maxSourceDrifted = parseNonNegativeIntegerOption(
          parseOption(args, '--max-source-drifted'),
          '--max-source-drifted'
        ) ?? 0;
        const maxSourceSnapshotAgeHours = parseNumberOption(
          parseOption(args, '--max-source-snapshot-age-hours'),
          '--max-source-snapshot-age-hours'
        ) ?? 24;
        const enforceD2 = args.includes('--enforce-d2');
        const maxD2CountMismatches = parseNonNegativeIntegerOption(
          parseOption(args, '--max-d2-count-mismatches'),
          '--max-d2-count-mismatches'
        ) ?? 0;
        const maxD2LegacyOnly = parseNonNegativeIntegerOption(
          parseOption(args, '--max-d2-legacy-only'),
          '--max-d2-legacy-only'
        ) ?? 0;
        const maxD2DomainOnly = parseNonNegativeIntegerOption(
          parseOption(args, '--max-d2-domain-only'),
          '--max-d2-domain-only'
        ) ?? 0;
        const maxD2DomainDeficit = parseNonNegativeIntegerOption(
          parseOption(args, '--max-d2-domain-deficit'),
          '--max-d2-domain-deficit'
        ) ?? 0;
        const maxD2MissingLegacyLink = parseNonNegativeIntegerOption(
          parseOption(args, '--max-d2-missing-legacy-link'),
          '--max-d2-missing-legacy-link'
        ) ?? 0;
        const minD2ReplayCorrelationCoverage = parseRatioOption(
          parseOption(args, '--min-d2-replay-correlation-coverage'),
          '--min-d2-replay-correlation-coverage'
        ) ?? 0.2;

        const efficiencyRaw = await fs.readFile('docs/metrics/efficiency-latest.json', 'utf-8');
        const efficiency = JSON.parse(efficiencyRaw) as EfficiencyLatestSnapshot;
        const sourceGroundingRaw = await fs.readFile('docs/metrics/source-grounding-latest.json', 'utf-8');
        const sourceGrounding = JSON.parse(sourceGroundingRaw) as SourceGroundingLatestSnapshot;

        const tickets = await repository.listTickets('all');
        const attemptsByTicket = await repository.listAttemptsForTickets(tickets.map((ticket) => ticket.id));
        const failures: string[] = [];

        const efficiencyScore = Number(efficiency.efficiencyIndex?.score ?? 0);
        if (efficiencyScore < minEfficiencyScore) {
          failures.push(`efficiency-score-low:${efficiencyScore.toFixed(3)}<${minEfficiencyScore}`);
        }

        const blockedWindowMs = blockedWindowDays ? blockedWindowDays * 24 * 60 * 60 * 1000 : undefined;
        const blockedCount = tickets.filter((ticket) => {
          if (ticket.status !== 'blocked') {
            return false;
          }

          if (getTicketAutopilotRetryQuarantineReason(ticket) !== undefined) {
            return false;
          }

          if (blockedWindowMs === undefined) {
            return true;
          }

          const referenceAt = ticket.blockedAt ?? ticket.updatedAt ?? ticket.createdAt;
          return Date.now() - referenceAt.getTime() <= blockedWindowMs;
        }).length;
        if (blockedCount > maxBlockedTickets) {
          failures.push(`blocked-count-high:${blockedCount}>${maxBlockedTickets}`);
        }

        const p95AdmissionToCompleteMs = Number(efficiency.latencyMs?.admissionToComplete?.p95 ?? 0);
        if (p95AdmissionToCompleteMs > maxP95AdmissionToCompleteMs) {
          failures.push(`admission-to-complete-p95-high:${p95AdmissionToCompleteMs}>${maxP95AdmissionToCompleteMs}`);
        }

        const allowlistDenialRate = Number(efficiency.policy?.allowlistDenialRate ?? 0);
        if (allowlistDenialRate > maxAllowlistDenialRate) {
          failures.push(`allowlist-denial-rate-high:${allowlistDenialRate.toFixed(3)}>${maxAllowlistDenialRate}`);
        }

        const sourceGroundingCoverage = Number(sourceGrounding.groundingCoverage ?? 1);
        if (sourceGroundingCoverage < minSourceGroundingCoverage) {
          failures.push(
            `source-grounding-coverage-low:${sourceGroundingCoverage.toFixed(3)}<${minSourceGroundingCoverage}`
          );
        }

        const sourceEvidenceAuditableTickets = Number(sourceGrounding.eventEvidence?.auditableTickets ?? 0);
        const sourceEvidenceCoverage = Number(sourceGrounding.eventEvidence?.eventEvidenceCoverage ?? 1);
        const sourceDriftedTickets = sourceGrounding.eventEvidence?.driftedTickets ?? [];
        const sourceSnapshotTimestamp = sourceGrounding.timestamp;
        const sourceSnapshotMs = sourceSnapshotTimestamp ? Date.parse(sourceSnapshotTimestamp) : Number.NaN;
        const sourceSnapshotAgeHours = Number.isFinite(sourceSnapshotMs)
          ? (Date.now() - sourceSnapshotMs) / (60 * 60 * 1000)
          : Number.POSITIVE_INFINITY;

        if (!sourceSnapshotTimestamp || !Number.isFinite(sourceSnapshotMs)) {
          failures.push('source-grounding-snapshot-invalid');
        } else if (sourceSnapshotAgeHours > maxSourceSnapshotAgeHours) {
          failures.push(
            `source-grounding-snapshot-stale:${sourceSnapshotAgeHours.toFixed(2)}h>${maxSourceSnapshotAgeHours}`
          );
        }

        if (sourceEvidenceAuditableTickets > 0 && sourceEvidenceCoverage < minSourceEvidenceCoverage) {
          failures.push(
            `source-evidence-coverage-low:${sourceEvidenceCoverage.toFixed(3)}<${minSourceEvidenceCoverage}`
          );
        }

        if (sourceDriftedTickets.length > maxSourceDrifted) {
          failures.push(
            `source-evidence-drifted-high:${sourceDriftedTickets.length}>${maxSourceDrifted}`
          );
        }

        const actionableBackendReliabilityEntries = Object.entries(
          computeBackendReliabilityMetrics({
            tickets,
            attemptsByTicket,
            includeTicket: (ticket) => getTicketAutopilotRetryQuarantineReason(ticket) === undefined,
          })
        );
        for (const [backend, metrics] of actionableBackendReliabilityEntries) {
          if (metrics.totalAttempts < 10) {
            continue;
          }

          if (metrics.successRatio < minBackendSuccessRatio) {
            failures.push(
              `backend-reliability-low:${backend}:${metrics.successRatio.toFixed(2)}<${minBackendSuccessRatio}`
            );
          }
        }

        let d2Evaluation: D2GateEvaluation | undefined;
        if (enforceD2) {
          d2Evaluation = await evaluateD2Gate(repository, {
            maxCountMismatches: maxD2CountMismatches,
            maxLegacyOnly: maxD2LegacyOnly,
            maxDomainOnly: maxD2DomainOnly,
            maxDomainDeficit: maxD2DomainDeficit,
            maxMissingLegacyLink: maxD2MissingLegacyLink,
            minReplayCorrelationCoverage: minD2ReplayCorrelationCoverage,
          });
          failures.push(...d2Evaluation.failures);
        }

        console.log('Hephaestus wave review');
        console.log(`Decision: ${failures.length === 0 ? 'GO' : 'NO-GO'}`);
        console.log(`Efficiency score: ${efficiencyScore.toFixed(3)} (threshold ${minEfficiencyScore})`);
        const blockedWindowLabel = blockedWindowDays ? ` within ${blockedWindowDays}d` : '';
        console.log(`Blocked tickets${blockedWindowLabel}: ${blockedCount} (threshold ${maxBlockedTickets})`);
        console.log(`Admission->complete p95 (ms): ${p95AdmissionToCompleteMs} (threshold ${maxP95AdmissionToCompleteMs})`);
        console.log(`Allowlist denial rate: ${allowlistDenialRate.toFixed(3)} (threshold ${maxAllowlistDenialRate})`);
        console.log(
          `Source grounding coverage: ${sourceGroundingCoverage.toFixed(3)} (threshold ${minSourceGroundingCoverage})`
        );
        console.log(
          `Source grounding tickets: ${Number(sourceGrounding.groundedTickets ?? 0)}/${Number(sourceGrounding.requiredTickets ?? 0)}`
        );
        if (sourceSnapshotTimestamp && Number.isFinite(sourceSnapshotMs)) {
          console.log(
            `Source snapshot age (h): ${sourceSnapshotAgeHours.toFixed(2)} (threshold ${maxSourceSnapshotAgeHours})`
          );
        } else {
          console.log(`Source snapshot age (h): invalid (threshold ${maxSourceSnapshotAgeHours})`);
        }
        console.log(
          `Source event evidence coverage: ${sourceEvidenceCoverage.toFixed(3)} (threshold ${minSourceEvidenceCoverage})`
        );
        console.log(
          `Source event evidence tickets: ${Number(sourceGrounding.eventEvidence?.ticketsWithEventEvidence ?? 0)}/${sourceEvidenceAuditableTickets}`
        );
        console.log(
          `Source drifted tickets: ${sourceDriftedTickets.length} (threshold ${maxSourceDrifted})`
        );
        if (d2Evaluation) {
          console.log(
            `D2 replay correlation coverage: ${d2Evaluation.replaySummary.correlationCoverage.toFixed(3)} (threshold ${minD2ReplayCorrelationCoverage})`
          );
          console.log(`D2 replay hash: ${d2Evaluation.replaySummary.replayHash}`);
          console.log(
            `D2 count mismatch tickets: ${d2Evaluation.snapshot.ticketsWithCountMismatch.length} (threshold ${maxD2CountMismatches})`
          );
          console.log(`D2 domain deficit: ${d2Evaluation.domainDeficit} (threshold ${maxD2DomainDeficit})`);
          console.log(
            `D2 missing legacy link rows: ${d2Evaluation.missingLegacyLink} (threshold ${maxD2MissingLegacyLink})`
          );
        }
        if (actionableBackendReliabilityEntries.length === 0) {
          console.log('Backend reliability: unavailable (no attributed attempts)');
        } else {
          console.log(
            `Backend reliability: ${actionableBackendReliabilityEntries
              .map(([backend, metrics]) => `${backend}=${metrics.completedAttempts}/${metrics.totalAttempts} (${metrics.successRatio.toFixed(2)})`)
              .join(', ')}`
          );
        }

        if (failures.length > 0) {
          console.log('Gate failures:');
          for (const failure of failures) {
            console.log(`- ${failure}`);
          }
        }
        break;
      }

      case 'render-board': {
        const board = await repository.renderTaskBoardProjection();
        process.stdout.write(board);
        break;
      }

      case 'sync-board': {
        await repository.syncProjection();
        console.log('TASKS.md projection sync attempted.');
        break;
      }

      default:
        throw new Error(`Unknown command: ${command}`);
    }
  } finally {
    await repository.stop();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
