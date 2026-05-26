import { TicketStoreRepository } from './task-store.js';
import type { TaskStatus } from './types.js';

const validStatuses: TaskStatus[] = [
  'pending',
  'in_progress',
  'completed',
  'blocked',
  'cancelled',
];

function printUsage(): void {
  console.log(`Hephaestus ticket CLI

Usage:
  npm run tickets -- create <description>
  npm run tickets -- list [--status <status>]
  npm run tickets -- show <ticket-id>
  npm run tickets -- retry <ticket-id>
  npm run tickets -- render-board
  npm run tickets -- sync-board

Statuses:
  pending, in_progress, completed, blocked, cancelled
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

        const events = await repository.listEvents(ticket.id);
        if (events.length > 0) {
          console.log('Events:');
          for (const event of events) {
            const details = event.details ? ` - ${event.details}` : '';
            console.log(`  ${event.createdAt.toISOString()} ${event.type}${details}`);
          }
        }
        break;
      }

      case 'retry': {
        const ticketId = args[0];
        if (!ticketId) {
          throw new Error('retry requires a ticket id.');
        }

        const ticket = await repository.retryTicket(ticketId);
        console.log(`Retried ${ticket.id}; new status: ${ticket.status}`);
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
