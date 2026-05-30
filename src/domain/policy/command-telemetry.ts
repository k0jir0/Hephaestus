import type { EngineeringToolStatus, TaskAttempt } from '../../types.js';
import { resolveCommandCatalogEntry } from './command-catalog-policy.js';

export interface CommandAttemptTelemetry {
  commandCallCount: number;
  commandIdCallCount: number;
  rawCommandCallCount: number;
  allowlistDenialCount: number;
  commandIds: Record<string, number>;
}

export interface CommandTelemetrySummary extends CommandAttemptTelemetry {
  commandIdUsageRate: number;
  allowlistDenialRate: number;
}

export interface CommandTelemetryAggregate extends CommandTelemetrySummary {
  allowlistDeniedAttemptCount: number;
  allowlistDeniedAttemptRate: number;
  topCommandIds: Array<{ commandId: string; count: number }>;
}

export function createCommandAttemptTelemetry(): CommandAttemptTelemetry {
  return {
    commandCallCount: 0,
    commandIdCallCount: 0,
    rawCommandCallCount: 0,
    allowlistDenialCount: 0,
    commandIds: {},
  };
}

export function recordCommandTelemetry(
  telemetry: CommandAttemptTelemetry,
  input: {
    commandId?: string;
    status?: EngineeringToolStatus;
    reasonCode?: string;
  }
): void {
  telemetry.commandCallCount += 1;

  if (input.commandId) {
    telemetry.commandIdCallCount += 1;
    telemetry.commandIds[input.commandId] = (telemetry.commandIds[input.commandId] ?? 0) + 1;
  } else {
    telemetry.rawCommandCallCount += 1;
  }

  if (input.status === 'denied' && input.reasonCode === 'command-not-allowlisted') {
    telemetry.allowlistDenialCount += 1;
  }
}

export function summarizeCommandTelemetry(telemetry: CommandAttemptTelemetry): CommandTelemetrySummary {
  return {
    commandCallCount: telemetry.commandCallCount,
    commandIdCallCount: telemetry.commandIdCallCount,
    rawCommandCallCount: telemetry.rawCommandCallCount,
    allowlistDenialCount: telemetry.allowlistDenialCount,
    commandIds: { ...telemetry.commandIds },
    commandIdUsageRate: roundRate(telemetry.commandIdCallCount / Math.max(1, telemetry.commandCallCount)),
    allowlistDenialRate: roundRate(telemetry.allowlistDenialCount / Math.max(1, telemetry.commandCallCount)),
  };
}

export function hasCommandTelemetry(telemetry: CommandAttemptTelemetry): boolean {
  return telemetry.commandCallCount > 0;
}

export function summarizeCommandTelemetryFromAttempts(attempts: TaskAttempt[]): CommandTelemetryAggregate {
  const aggregate = createCommandAttemptTelemetry();
  let allowlistDeniedAttemptCount = 0;

  for (const attempt of attempts) {
    const attemptTelemetry = extractCommandTelemetryFromAttempt(attempt);
    mergeCommandTelemetry(aggregate, attemptTelemetry);
    if (attemptTelemetry.allowlistDenialCount > 0 || /allowlist|allowlisted/i.test(attempt.error ?? '')) {
      allowlistDeniedAttemptCount += 1;
    }
  }

  const summary = summarizeCommandTelemetry(aggregate);
  return {
    ...summary,
    allowlistDeniedAttemptCount,
    allowlistDeniedAttemptRate: roundRate(allowlistDeniedAttemptCount / Math.max(1, attempts.length)),
    topCommandIds: Object.entries(summary.commandIds)
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, 7)
      .map(([commandId, count]) => ({ commandId, count })),
  };
}

export function formatCommandTelemetryArtifact(
  correlationId: string,
  telemetry: CommandAttemptTelemetry
): string | undefined {
  if (!hasCommandTelemetry(telemetry)) {
    return undefined;
  }

  return `[${correlationId}] command.telemetry ${JSON.stringify(summarizeCommandTelemetry(telemetry))}`;
}

function extractCommandTelemetryFromAttempt(attempt: TaskAttempt): CommandAttemptTelemetry {
  const explicitTelemetry = extractExplicitTelemetry(attempt.artifacts);
  if (explicitTelemetry.commandCallCount > 0) {
    return explicitTelemetry;
  }

  return extractLegacyTelemetry(attempt.artifacts);
}

function extractExplicitTelemetry(artifacts: string[]): CommandAttemptTelemetry {
  const telemetry = createCommandAttemptTelemetry();

  for (const artifact of artifacts) {
    const match = artifact.match(/\]\s+command\.telemetry\s+(?<payload>\{.+\})$/);
    if (!match?.groups?.payload) {
      continue;
    }

    try {
      const parsed = JSON.parse(match.groups.payload) as Partial<CommandTelemetrySummary>;
      mergeCommandTelemetry(telemetry, normalizeParsedTelemetry(parsed));
    } catch {
      continue;
    }
  }

  return telemetry;
}

function extractLegacyTelemetry(artifacts: string[]): CommandAttemptTelemetry {
  const telemetry = createCommandAttemptTelemetry();

  for (const artifact of artifacts) {
    const match = artifact.match(
      /\]\s+command\.run\s+(?<subject>.+)\s+->\s+(?<status>success|failure|denied|dry_run)(?:\s+\[(?<reasonCode>[^\]]+)\])?:/
    );
    if (!match?.groups?.subject) {
      continue;
    }

    recordCommandTelemetry(telemetry, {
      commandId: extractCommandIdFromSubject(match.groups.subject),
      status: match.groups.status as EngineeringToolStatus,
      reasonCode: match.groups.reasonCode,
    });
  }

  return telemetry;
}

function normalizeParsedTelemetry(parsed: Partial<CommandTelemetrySummary>): CommandAttemptTelemetry {
  const telemetry = createCommandAttemptTelemetry();
  telemetry.commandCallCount = normalizeCount(parsed.commandCallCount);
  telemetry.commandIdCallCount = normalizeCount(parsed.commandIdCallCount);
  telemetry.rawCommandCallCount = normalizeCount(parsed.rawCommandCallCount);
  telemetry.allowlistDenialCount = normalizeCount(parsed.allowlistDenialCount);

  if (parsed.commandIds && typeof parsed.commandIds === 'object' && !Array.isArray(parsed.commandIds)) {
    for (const [commandId, count] of Object.entries(parsed.commandIds)) {
      const normalizedCount = normalizeCount(count);
      if (normalizedCount > 0) {
        telemetry.commandIds[commandId] = normalizedCount;
      }
    }
  }

  return telemetry;
}

function mergeCommandTelemetry(target: CommandAttemptTelemetry, source: CommandAttemptTelemetry): void {
  target.commandCallCount += source.commandCallCount;
  target.commandIdCallCount += source.commandIdCallCount;
  target.rawCommandCallCount += source.rawCommandCallCount;
  target.allowlistDenialCount += source.allowlistDenialCount;

  for (const [commandId, count] of Object.entries(source.commandIds)) {
    target.commandIds[commandId] = (target.commandIds[commandId] ?? 0) + count;
  }
}

function extractCommandIdFromSubject(subject: string): string | undefined {
  const commandId = subject.split(/\s+->\s+/, 1)[0]?.trim();
  return commandId && resolveCommandCatalogEntry(commandId) ? commandId : undefined;
}

function normalizeCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

function roundRate(value: number): number {
  return Number(value.toFixed(3));
}
