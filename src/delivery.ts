import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import type { TaskAttempt, TaskEvent, TaskTicket, ToolCall } from './types.js';

export interface PatchBundleRepository {
  getTicket(ticketId: string): Promise<TaskTicket | null>;
  listAttempts(ticketId: string): Promise<TaskAttempt[]>;
  listEvents(ticketId: string): Promise<TaskEvent[]>;
}

export interface PatchBundleExport {
  outputDir: string;
  patchFile: string;
  manifestFile: string;
  readmeFile: string;
  patchCount: number;
}

export interface PatchBundleExportOptions {
  outputRoot?: string;
  generatedAt?: Date;
}

export async function exportPatchBundle(
  repository: PatchBundleRepository,
  ticketId: string,
  options: PatchBundleExportOptions = {}
): Promise<PatchBundleExport> {
  const ticket = await repository.getTicket(ticketId);
  if (!ticket) {
    throw new Error(`Ticket not found: ${ticketId}`);
  }

  const attempts = await repository.listAttempts(ticketId);
  const events = await repository.listEvents(ticketId);
  const patches = collectPatchToolCalls(ticket, attempts);
  if (patches.length === 0) {
    throw new Error(`Ticket ${ticketId} does not contain patch.apply tool calls to export.`);
  }

  const generatedAt = options.generatedAt ?? new Date();
  const outputRoot = options.outputRoot ?? path.join(config.baseDir, '.hephaestus', 'delivery');
  const outputDir = path.join(outputRoot, sanitizePathSegment(ticket.id));
  const patchFile = path.join(outputDir, 'bundle.patch');
  const manifestFile = path.join(outputDir, 'manifest.json');
  const readmeFile = path.join(outputDir, 'README.md');

  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(patchFile, `${patches.map((entry) => entry.patch.trimEnd()).join('\n\n')}\n`, 'utf-8');
  await fs.writeFile(
    manifestFile,
    `${JSON.stringify(buildManifest(ticket, attempts, events, patches, generatedAt), null, 2)}\n`,
    'utf-8'
  );
  await fs.writeFile(readmeFile, buildReadme(ticket, patches.length, attempts), 'utf-8');

  return {
    outputDir,
    patchFile,
    manifestFile,
    readmeFile,
    patchCount: patches.length,
  };
}

function collectPatchToolCalls(
  ticket: TaskTicket,
  attempts: TaskAttempt[]
): Array<{ source: string; patch: string }> {
  const patches: Array<{ source: string; patch: string }> = [];
  const seen = new Set<string>();

  addToolCallPatches(`ticket:${ticket.id}`, ticket.toolCalls, patches, seen);
  for (const attempt of attempts) {
    addToolCallPatches(`attempt:${attempt.attemptNumber}:${attempt.id}`, attempt.toolCalls, patches, seen);
  }

  return patches;
}

function addToolCallPatches(
  source: string,
  toolCalls: ToolCall[] | undefined,
  patches: Array<{ source: string; patch: string }>,
  seen: Set<string>
): void {
  for (const toolCall of toolCalls ?? []) {
    if (toolCall.name !== 'patch.apply' || typeof toolCall.arguments.patch !== 'string') {
      continue;
    }

    const patch = toolCall.arguments.patch.trim();
    if (!patch || seen.has(patch)) {
      continue;
    }

    seen.add(patch);
    patches.push({ source, patch });
  }
}

function buildManifest(
  ticket: TaskTicket,
  attempts: TaskAttempt[],
  events: TaskEvent[],
  patches: Array<{ source: string; patch: string }>,
  generatedAt: Date
): Record<string, unknown> {
  const workspaceProvenance = summarizeWorkspaceProvenance(attempts);

  return {
    version: 'hephaestus-patch-bundle/v1',
    generatedAt: generatedAt.toISOString(),
    ticket: {
      id: ticket.id,
      description: ticket.description,
      status: ticket.status,
      attemptCount: ticket.attemptCount,
      updatedAt: ticket.updatedAt.toISOString(),
    },
    patches: patches.map((patch, index) => ({
      index: index + 1,
      source: patch.source,
    })),
    attempts: attempts.map((attempt) => ({
      id: attempt.id,
      attemptNumber: attempt.attemptNumber,
      status: attempt.status,
      workspaceId: attempt.workspaceId,
      workspaceRoot: attempt.workspaceRoot,
      isolationMode: attempt.isolationMode,
      startedAt: attempt.startedAt.toISOString(),
      endedAt: attempt.endedAt?.toISOString(),
      artifactCount: attempt.artifacts.length,
    })),
    workspaceProvenance,
    eventCount: events.length,
    files: {
      patch: 'bundle.patch',
      manifest: 'manifest.json',
      readme: 'README.md',
    },
  };
}

function buildReadme(ticket: TaskTicket, patchCount: number, attempts: TaskAttempt[]): string {
  const workspaceProvenance = summarizeWorkspaceProvenance(attempts);

  return [
    `# Hephaestus Patch Bundle: ${ticket.id}`,
    '',
    `Ticket: ${ticket.description}`,
    `Status: ${ticket.status}`,
    `Patch count: ${patchCount}`,
    `Workspace mode(s): ${workspaceProvenance.modes.join(', ') || 'none'}`,
    `Workspace id(s): ${workspaceProvenance.workspaceIds.join(', ') || 'none'}`,
    '',
    'This bundle is a local delivery artifact. Review `manifest.json`, inspect `bundle.patch`, and apply it manually with your normal review process.',
    '',
    'Suggested local review command:',
    '',
    '```sh',
    'git apply --check bundle.patch',
    '```',
    '',
  ].join('\n');
}

function summarizeWorkspaceProvenance(attempts: TaskAttempt[]): {
  modes: string[];
  workspaceIds: string[];
  workspaceRoots: string[];
} {
  const modes = new Set<string>();
  const workspaceIds = new Set<string>();
  const workspaceRoots = new Set<string>();

  for (const attempt of attempts) {
    if (attempt.isolationMode) {
      modes.add(attempt.isolationMode);
    }
    if (attempt.workspaceId) {
      workspaceIds.add(attempt.workspaceId);
    }
    if (attempt.workspaceRoot) {
      workspaceRoots.add(attempt.workspaceRoot);
    }
  }

  return {
    modes: [...modes],
    workspaceIds: [...workspaceIds],
    workspaceRoots: [...workspaceRoots],
  };
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]/g, '_');
}
