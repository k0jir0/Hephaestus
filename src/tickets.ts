import { TicketStoreRepository } from './task-store.js';
import { SelfAuditSeeder } from './self-audit.js';
import { computeOperationalSLOMetrics, formatOperationalSLOMetrics } from './slo-metrics.js';
import { runTicketAutopilot } from './ticket-autopilot.js';
import { exportPatchBundle } from './delivery.js';
import type { TaskStatus } from './types.js';

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
  npm run tickets -- autopilot [--include-cancelled] [--no-self-audit] [--self-audit-limit <count>] [--max-attempts <count>] [--dry-run]
  npm run tickets -- approve <ticket-id> <reviewer> [reason]
  npm run tickets -- reject <ticket-id> <reviewer> [reason]
  npm run tickets -- resume <ticket-id>
  npm run tickets -- cancel <ticket-id> [reason]
  npm run tickets -- supersede <ticket-id> [reason]
  npm run tickets -- export-bundle <ticket-id> [--out <directory>]
  npm run tickets -- attempts <ticket-id>
  npm run tickets -- self-audit [--limit <count>] [--dry-run]
  npm run tickets -- metrics
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

function parseOption(args: string[], name: string): string | undefined {
  const optionIndex = args.indexOf(name);
  if (optionIndex === -1) {
    return undefined;
  }

  return args[optionIndex + 1];
}

function formatTimestamp(value: Date | undefined): string {
  return value ? value.toISOString() : '-';
}

function parsePositiveInteger(value: string | undefined, optionName: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${optionName} must be a positive integer.`);
  }

  return parsed;
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
        const ticket = await repository.retryTicket(ticketId, { amendedDescription });
        console.log(`Retried ${ticket.id}; new status: ${ticket.status}`);
        if (amendedDescription) {
          console.log(`Amended description: ${ticket.description}`);
        }
        break;
      }

      case 'autopilot': {
        const includeCancelled = args.includes('--include-cancelled');
        const seedSelfAuditWhenIdle = !args.includes('--no-self-audit');
        const dryRun = args.includes('--dry-run');
        const selfAuditLimit = parsePositiveInteger(
          parseOption(args, '--self-audit-limit'),
          '--self-audit-limit'
        );
        const maxAttempts = parsePositiveInteger(parseOption(args, '--max-attempts'), '--max-attempts');
        const result = await runTicketAutopilot(
          {
            repository,
            selfAuditSeeder: new SelfAuditSeeder({ repository }),
          },
          {
            includeCancelled,
            dryRun,
            seedSelfAuditWhenIdle,
            selfAuditLimit,
            maxAttempts,
          }
        );

        console.log(`Existing runnable tickets: ${result.runnableTicketCount}`);
        console.log(`Awaiting approval tickets: ${result.awaitingApprovalCount}`);

        for (const ticket of result.resumed) {
          console.log(`${dryRun ? 'Would resume' : 'Resumed'} ${ticket.id} ${ticket.description}`);
        }

        for (const ticket of result.requeued) {
          console.log(`${dryRun ? 'Would requeue' : 'Requeued'} ${ticket.id} ${ticket.description}`);
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

        if (result.queueReady) {
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
        const attemptsByTicket = new Map(
          await Promise.all(
            tickets.map(async (ticket) => [ticket.id, await repository.listAttempts(ticket.id)] as const)
          )
        );
        const events = await repository.listEvents();
        const metrics = computeOperationalSLOMetrics({ tickets, attemptsByTicket, events });
        console.log(formatOperationalSLOMetrics(metrics));
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
