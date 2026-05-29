import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import type { TaskAttempt, TaskEvent, TaskStatus, TaskTicket } from './types.js';

export type CodexExecutionLane = 'fast' | 'deep';

export interface CodexRoutingEvidence {
  score: number;
  threshold: number;
  signals: string[];
  localRetryCap: number;
  recommendedLane: CodexExecutionLane;
}

export interface CodexHandoffRepository {
  listTickets(status: TaskStatus | 'all'): Promise<TaskTicket[]>;
  listAttempts(ticketId: string): Promise<TaskAttempt[]>;
  listAttemptsForTickets?(ticketIds?: string[]): Promise<Map<string, TaskAttempt[]>>;
  listEvents(ticketId?: string): Promise<TaskEvent[]>;
  listRecentEvents?(options?: { ticketId?: string; limit?: number }): Promise<TaskEvent[]>;
}

export interface CodexHandoffBundle {
  version: 'hephaestus-codex-handoff/v1';
  generatedAt: string;
  lane: CodexExecutionLane;
  laneReason: string;
  routingEvidence: CodexRoutingEvidence;
  ticket: {
    id: string;
    description: string;
    status: TaskStatus;
    attemptCount: number;
    updatedAt: string;
  };
  codexContext: {
    prompt: string;
    recentArtifacts: string[];
    recentEvents: Array<{
      type: string;
      createdAt: string;
      details?: string;
    }>;
    pendingToolCalls: string[];
    localAssistedHandoff: {
      attemptedCommands: string[];
      failedActions: string[];
      recommendedNextStep: string;
    };
  };
}

export interface CodexHandoffExportOptions {
  outputRoot?: string;
  statuses?: TaskStatus[];
  generatedAt?: Date;
}

export interface ExportedCodexHandoffBundle {
  ticketId: string;
  lane: CodexExecutionLane;
  outputFile: string;
}

const DEFAULT_ACTIVE_STATUSES: TaskStatus[] = [
  'pending',
  'in_progress',
  'planned',
  'awaiting_approval',
  'blocked',
];

export function routeCodexExecutionLane(
  ticket: TaskTicket,
  attempts: TaskAttempt[],
  events: TaskEvent[]
): { lane: CodexExecutionLane; reason: string; score: number; threshold: number; signals: string[] } {
  let score = 0;
  const threshold = 4;
  const reasons: string[] = [];

  if (ticket.status === 'awaiting_approval' || ticket.status === 'blocked') {
    score += 3;
    reasons.push(`status=${ticket.status}`);
  }

  if (ticket.attemptCount >= 3 || attempts.length >= 3) {
    score += 2;
    reasons.push('high retry pressure');
  }

  if (ticket.description.length > 140) {
    score += 1;
    reasons.push('long task description');
  }

  if (/(architecture|migration|protocol|security|database|refactor|performance)/i.test(ticket.description)) {
    score += 2;
    reasons.push('complexity keywords');
  }

  if (events.some((event) => event.type === 'approval-requested')) {
    score += 1;
    reasons.push('approval lifecycle present');
  }

  if (score >= 4) {
    return {
      lane: 'deep',
      reason: reasons.length > 0 ? reasons.join(', ') : 'risk/complexity threshold met',
      score,
      threshold,
      signals: reasons,
    };
  }

  return {
    lane: 'fast',
    reason: reasons.length > 0 ? reasons.join(', ') : 'low-complexity ticket with limited risk signals',
    score,
    threshold,
    signals: reasons,
  };
}

export function buildCodexHandoffBundle(
  ticket: TaskTicket,
  attempts: TaskAttempt[],
  events: TaskEvent[],
  generatedAt: Date
): CodexHandoffBundle {
  const laneDecision = routeCodexExecutionLane(ticket, attempts, events);
  const latestAttempt = attempts
    .slice()
    .sort((left, right) => left.attemptNumber - right.attemptNumber)
    .at(-1);

  const recentArtifacts = (latestAttempt?.artifacts ?? []).slice(-12);
  const recentEvents = events
    .slice()
    .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
    .slice(-8)
    .map((event) => ({
      type: event.type,
      createdAt: event.createdAt.toISOString(),
      details: event.details,
    }));
  const pendingToolCalls = (ticket.toolCalls ?? []).map((toolCall) => toolCall.name);
  const allArtifacts = attempts.flatMap((attempt) => attempt.artifacts);
  const attemptedCommands = extractAttemptedCommands(allArtifacts);
  const failedActions = allArtifacts
    .filter((artifact) => /->\s*(denied|failure)|command is not allowlisted|approval-required/i.test(artifact))
    .slice(-8);

  const lanePrompt = laneDecision.lane === 'fast'
    ? 'Use a minimal-change fast lane: prioritize the smallest safe patch and one narrow verification command.'
    : 'Use a deep lane: perform a brief design-first analysis, then apply phased edits with explicit verification checkpoints.';

  return {
    version: 'hephaestus-codex-handoff/v1',
    generatedAt: generatedAt.toISOString(),
    lane: laneDecision.lane,
    laneReason: laneDecision.reason,
    routingEvidence: {
      score: laneDecision.score,
      threshold: laneDecision.threshold,
      signals: laneDecision.signals,
      localRetryCap: 2,
      recommendedLane: laneDecision.lane,
    },
    ticket: {
      id: ticket.id,
      description: ticket.description,
      status: ticket.status,
      attemptCount: ticket.attemptCount,
      updatedAt: ticket.updatedAt.toISOString(),
    },
    codexContext: {
      prompt: [
        lanePrompt,
        `Ticket: ${ticket.description}`,
        `Current status: ${ticket.status}`,
        `Attempt count: ${ticket.attemptCount}`,
      ].join('\n'),
      recentArtifacts,
      recentEvents,
      pendingToolCalls,
      localAssistedHandoff: {
        attemptedCommands,
        failedActions,
        recommendedNextStep:
          laneDecision.lane === 'deep'
            ? 'Escalate to Codex deep lane with phased checkpoints and explicit verification.'
            : 'Stay in fast lane for a minimal patch and one narrow verification command.',
      },
    },
  };
}

export async function exportCodexHandoffBundles(
  repository: CodexHandoffRepository,
  options: CodexHandoffExportOptions = {}
): Promise<ExportedCodexHandoffBundle[]> {
  const generatedAt = options.generatedAt ?? new Date();
  const outputRoot = options.outputRoot ?? path.join(config.baseDir, '.hephaestus', 'codex-handoff');
  const statuses = options.statuses ?? DEFAULT_ACTIVE_STATUSES;

  const allTickets = await repository.listTickets('all');
  const eligible = allTickets.filter((ticket) => statuses.includes(ticket.status));
  const attemptsByTicket = repository.listAttemptsForTickets
    ? await repository.listAttemptsForTickets(eligible.map((ticket) => ticket.id))
    : new Map<string, TaskAttempt[]>();
  const exported: ExportedCodexHandoffBundle[] = [];

  await fs.mkdir(outputRoot, { recursive: true });

  for (const ticket of eligible) {
    const attempts = attemptsByTicket.get(ticket.id) ?? (await repository.listAttempts(ticket.id));
    const events = repository.listRecentEvents
      ? await repository.listRecentEvents({ ticketId: ticket.id, limit: 8 })
      : await repository.listEvents(ticket.id);
    const bundle = buildCodexHandoffBundle(ticket, attempts, events, generatedAt);
    const outputFile = path.join(outputRoot, `${sanitizeFileSegment(ticket.id)}.json`);
    await fs.writeFile(outputFile, `${JSON.stringify(bundle, null, 2)}\n`, 'utf-8');
    exported.push({ ticketId: ticket.id, lane: bundle.lane, outputFile });
  }

  return exported;
}

function sanitizeFileSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]/g, '_');
}

function extractAttemptedCommands(artifacts: string[]): string[] {
  const commands: string[] = [];
  for (const artifact of artifacts) {
    const match = artifact.match(/command\.run\s+(.+?)\s+->/i);
    if (match?.[1]) {
      commands.push(match[1].trim());
    }
  }

  return Array.from(new Set(commands)).slice(-8);
}
