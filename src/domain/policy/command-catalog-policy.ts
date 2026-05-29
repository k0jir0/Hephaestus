import type { ToolPolicyCommandCatalogEntry } from '../../types.js';

export interface CommandCatalogMapping {
  command: string;
  args: string[];
}

export interface CommandCatalogEntry {
  id: string;
  command: string;
  args: string[];
  purpose: string;
  platforms: {
    posix: CommandCatalogMapping;
    win32: CommandCatalogMapping;
  };
}

function npmCatalogEntry(id: string, args: string[], purpose: string): CommandCatalogEntry {
  return {
    id,
    command: 'npm',
    args,
    purpose,
    platforms: {
      posix: {
        command: 'npm',
        args,
      },
      win32: {
        command: 'npm.cmd',
        args,
      },
    },
  };
}

const commandCatalog: readonly CommandCatalogEntry[] = [
  npmCatalogEntry('npm.test', ['test'], 'Run the default test suite.'),
  npmCatalogEntry('npm.run.test', ['run', 'test'], 'Run the named test script.'),
  npmCatalogEntry('npm.run.build', ['run', 'build'], 'Compile TypeScript output.'),
  npmCatalogEntry('npm.run.validate-config', ['run', 'validate:config'], 'Validate runtime configuration before execution.'),
  npmCatalogEntry('npm.run.preflight', ['run', 'preflight'], 'Run preflight admission and health checks.'),
  npmCatalogEntry('npm.run.start-once', ['run', 'start:once'], 'Run one bounded agent pass.'),
  npmCatalogEntry('npm.run.tickets', ['run', 'tickets'], 'Run ticket CLI workflows.'),
  npmCatalogEntry('npm.run.lint', ['run', 'lint'], 'Run static lint checks.'),
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

export function resolveCommandCatalogEntryForPlatform(
  commandId: string,
  platform: NodeJS.Platform = process.platform
): CommandCatalogMapping | undefined {
  const entry = resolveCommandCatalogEntry(commandId);
  if (!entry) {
    return undefined;
  }

  return platform === 'win32' ? entry.platforms.win32 : entry.platforms.posix;
}

export function buildCommandCatalogPolicySnapshot(): ToolPolicyCommandCatalogEntry[] {
  return commandCatalog.map((entry) => ({
    id: entry.id,
    purpose: entry.purpose,
    command: entry.command,
    args: [...entry.args],
    platforms: {
      posix: {
        command: entry.platforms.posix.command,
        args: [...entry.platforms.posix.args],
      },
      win32: {
        command: entry.platforms.win32.command,
        args: [...entry.platforms.win32.args],
      },
    },
  }));
}
