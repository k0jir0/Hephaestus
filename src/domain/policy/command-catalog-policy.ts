export interface CommandCatalogEntry {
  id: string;
  command: string;
  args: string[];
  purpose: string;
}

const commandCatalog: readonly CommandCatalogEntry[] = [
  {
    id: 'npm.test',
    command: 'npm',
    args: ['test'],
    purpose: 'Run the default test suite.',
  },
  {
    id: 'npm.run.test',
    command: 'npm',
    args: ['run', 'test'],
    purpose: 'Run the named test script.',
  },
  {
    id: 'npm.run.build',
    command: 'npm',
    args: ['run', 'build'],
    purpose: 'Compile TypeScript output.',
  },
  {
    id: 'npm.run.validate-config',
    command: 'npm',
    args: ['run', 'validate:config'],
    purpose: 'Validate runtime configuration before execution.',
  },
  {
    id: 'npm.run.preflight',
    command: 'npm',
    args: ['run', 'preflight'],
    purpose: 'Run preflight admission and health checks.',
  },
  {
    id: 'npm.run.start-once',
    command: 'npm',
    args: ['run', 'start:once'],
    purpose: 'Run one bounded agent pass.',
  },
  {
    id: 'npm.run.tickets',
    command: 'npm',
    args: ['run', 'tickets'],
    purpose: 'Run ticket CLI workflows.',
  },
  {
    id: 'npm.run.lint',
    command: 'npm',
    args: ['run', 'lint'],
    purpose: 'Run static lint checks.',
  },
];

const catalogById = new Map(commandCatalog.map((entry) => [entry.id, entry]));

export function listCommandCatalogEntries(): readonly CommandCatalogEntry[] {
  return commandCatalog;
}

export function resolveCommandCatalogEntry(commandId: string): CommandCatalogEntry | undefined {
  const normalized = commandId.trim();
  if (!normalized) {
    return undefined;
  }

  return catalogById.get(normalized);
}
