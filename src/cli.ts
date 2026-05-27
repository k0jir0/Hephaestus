import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { TicketStoreRepository } from './task-store.js';

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const rl = readline.createInterface({ input: stdin, output: stdout });
  const repo = new TicketStoreRepository();

  async function handleOne(parts: string[]): Promise<void> {
    const cmd = (parts[0] || '').toLowerCase();
    if (cmd === 'exit' || cmd === 'quit') return;
    if (cmd === 'list') {
      const tickets = await repo.listTickets('all');
      if (tickets.length === 0) {
        console.log('No tickets.');
        return;
      }
      for (const t of tickets) console.log(`${t.id}\t${t.status}\t${t.description}`);
      return;
    }
    if (cmd === 'show') {
      const id = parts[1];
      if (!id) throw new Error('Usage: show <ticket-id>');
      const ticket = await repo.getTicket(id);
      console.log(ticket ?? `Ticket not found: ${id}`);
      return;
    }
    if (cmd === 'create') {
      const desc = parts.slice(1).join(' ');
      if (!desc) throw new Error('Usage: create <description>');
      const ticket = await repo.createTicket(desc);
      console.log(`Created ${ticket.id} [${ticket.status}] ${ticket.description}`);
      return;
    }
    // default: treat as description
    const ticket = await repo.createTicket(parts.join(' '));
    console.log(`Created ${ticket.id} [${ticket.status}] ${ticket.description}`);
  }

  console.log('Hephaestus CLI — interactive ticket creator');
  console.log('Commands:');
  console.log('  list                 — list tickets');
  console.log('  show <id>            — show ticket details');
  console.log('  create <description> — create a ticket');
  console.log('  exit                 — quit');

  try {
    if (argv.length > 0) {
      try {
        await handleOne(argv);
      } finally {
        await repo.stop();
        rl.close();
      }
      return;
    }

    for (;;) {
      const line = await rl.question('> ');
      const trimmed = line.trim();
      if (!trimmed) continue;
      const parts = trimmed.split(/\s+/);

      try {
        if (parts[0].toLowerCase() === 'exit' || parts[0].toLowerCase() === 'quit') break;
        await handleOne(parts);
      } catch (err) {
        console.error('Error:', err instanceof Error ? err.message : String(err));
      }
    }
  } finally {
    await repo.stop();
    rl.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
