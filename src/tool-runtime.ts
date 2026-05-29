import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ToolRuntimeReadinessProbe } from './repositories.js';
import type { EngineeringToolName, EngineeringToolResult, ToolPolicySnapshot } from './types.js';

type ToolRequest =
  | RepoSearchRequest
  | FileReadRequest
  | PatchApplyRequest
  | CommandRunRequest
  | UnsupportedDeliveryRequest;

interface RepoSearchRequest {
  tool: 'repo.search';
  query: string;
  maxResults?: number;
}

interface FileReadRequest {
  tool: 'file.read';
  path: string;
  startLine?: number;
  endLine?: number;
  maxBytes?: number;
}

interface PatchApplyRequest {
  tool: 'patch.apply';
  patch: string;
  dryRun?: boolean;
  approvalId?: string;
}

interface CommandRunRequest {
  tool: 'command.run';
  command: string;
  args?: string[];
  cwd?: string;
  timeoutMs?: number;
}

interface UnsupportedDeliveryRequest {
  tool: 'git.branch' | 'git.commit' | 'github.pr';
}

export type EngineeringToolRequest = ToolRequest;

export interface CommandAllowlistEntry {
  command: string;
  args: string[];
}

export interface EngineeringToolPolicy {
  workspaceRoot: string;
  dryRun?: boolean;
  maxReadBytes?: number;
  maxOutputBytes?: number;
  maxSearchResults?: number;
  commandTimeoutMs?: number;
  commandAllowlist?: CommandAllowlistEntry[];
  protectedPathPrefixes?: string[];
  maxSafePatchPaths?: number;
  maxSafePatchChangedLines?: number;
}

interface PatchRiskAssessment {
  requiresApproval: boolean;
  changedLines: number;
  reasons: string[];
}

const ignoredDirectoryNames = new Set([
  '.git',
  'node_modules',
  'dist',
  'coverage',
  'logs',
]);

const defaultProtectedPathPrefixes = [
  '.git',
  'node_modules',
  'dist',
  '.env',
  '.env.local',
  '.hephaestus-tickets.db',
  '.hephaestus-tickets.db-shm',
  '.hephaestus-tickets.db-wal',
];

const defaultCommandAllowlist: CommandAllowlistEntry[] = [
  { command: 'npm', args: ['test'] },
  { command: 'npm', args: ['run', 'test'] },
  { command: 'npm', args: ['run', 'lint'] },
  { command: 'npm', args: ['run', 'build'] },
  { command: 'npm', args: ['run', 'validate:config'] },
  { command: 'npm', args: ['run', 'preflight'] },
  { command: 'npm', args: ['run', 'start:once'] },
  { command: 'npm', args: ['run', 'tickets'] },
  { command: 'npm', args: ['run', 'models:report'] },
  { command: 'npm', args: ['run', 'models:smoke'] },
  { command: 'npm', args: ['run', 'models:benchmark'] },
  { command: 'npm', args: ['run', 'models:recommend'] },
  { command: 'npm', args: ['run', 'models:promote'] },
  { command: 'npm', args: ['run', 'models:warmup'] },
  { command: 'npm', args: ['run', 'publish:reliability'] },
  { command: 'npm', args: ['run', 'metrics:efficiency:weekly'] },
  { command: 'node', args: ['scripts/run-tests.mjs'] },
  { command: 'node_modules/.bin/tsc', args: ['--noEmit'] },
  { command: 'node_modules\\.bin\\tsc.cmd', args: ['--noEmit'] },
];

function normalizeCommandForPolicy(command: string): string {
  const lowerCaseBasename = path.win32.basename(command).toLowerCase();
  if (lowerCaseBasename === 'npm' || lowerCaseBasename === 'npm.cmd') {
    return 'npm';
  }

  if (lowerCaseBasename === 'npx' || lowerCaseBasename === 'npx.cmd') {
    return 'npx';
  }

  return command.replace(/\\/g, '/').toLowerCase();
}

function resolveCommandForPlatform(command: string): string {
  if (process.platform !== 'win32') {
    return command;
  }

  const lowerCaseBasename = path.win32.basename(command).toLowerCase();
  if (lowerCaseBasename === 'npm') {
    return 'npm.cmd';
  }

  if (lowerCaseBasename === 'npx') {
    return 'npx.cmd';
  }

  return command;
}

class ToolPolicyError extends Error {
  readonly reasonCode: string;

  constructor(reasonCode: string, message: string) {
    super(message);
    this.name = 'ToolPolicyError';
    this.reasonCode = reasonCode;
  }
}

export class EngineeringToolRuntime implements ToolRuntimeReadinessProbe {
  private readonly workspaceRoot: string;
  private readonly dryRun: boolean;
  private readonly maxReadBytes: number;
  private readonly maxOutputBytes: number;
  private readonly maxSearchResults: number;
  private readonly commandTimeoutMs: number;
  private readonly commandAllowlist: CommandAllowlistEntry[];
  private readonly protectedPathPrefixes: string[];
  private readonly maxSafePatchPaths: number;
  private readonly maxSafePatchChangedLines: number;

  constructor(policy: EngineeringToolPolicy) {
    this.workspaceRoot = path.resolve(policy.workspaceRoot);
    this.dryRun = policy.dryRun ?? false;
    this.maxReadBytes = policy.maxReadBytes ?? 128 * 1024;
    this.maxOutputBytes = policy.maxOutputBytes ?? 64 * 1024;
    this.maxSearchResults = policy.maxSearchResults ?? 50;
    this.commandTimeoutMs = policy.commandTimeoutMs ?? 60_000;
    this.commandAllowlist = policy.commandAllowlist ?? defaultCommandAllowlist;
    this.protectedPathPrefixes = policy.protectedPathPrefixes ?? defaultProtectedPathPrefixes;
    this.maxSafePatchPaths = policy.maxSafePatchPaths ?? 1;
    this.maxSafePatchChangedLines = policy.maxSafePatchChangedLines ?? 20;
  }

  getPolicySnapshot(): ToolPolicySnapshot {
    const snapshotBase = {
      version: 'hephaestus-tool-policy/v1',
      workspaceRoot: this.workspaceRoot,
      dryRunByDefault: this.dryRun,
      maxReadBytes: this.maxReadBytes,
      maxOutputBytes: this.maxOutputBytes,
      maxSearchResults: this.maxSearchResults,
      commandTimeoutMs: this.commandTimeoutMs,
      commandAllowlist: this.commandAllowlist.map((entry) => [entry.command, ...entry.args].join(' ')),
      protectedPathPrefixes: [...this.protectedPathPrefixes],
      patchRiskThresholds: {
        maxSafeTouchedPaths: this.maxSafePatchPaths,
        maxSafeChangedLines: this.maxSafePatchChangedLines,
      },
    };
    const signature = createHash('sha256')
      .update(JSON.stringify(snapshotBase))
      .digest('hex')
      .slice(0, 16);

    return {
      ...snapshotBase,
      generatedAt: new Date(),
      signature,
    };
  }

  async execute(request: EngineeringToolRequest): Promise<EngineeringToolResult> {
    const startedAt = new Date();

    try {
      switch (request.tool) {
        case 'repo.search':
          return this.finish(startedAt, request.tool, await this.searchRepo(request));
        case 'file.read':
          return this.finish(startedAt, request.tool, await this.readFile(request));
        case 'patch.apply':
          return this.finish(startedAt, request.tool, await this.applyPatch(request));
        case 'command.run':
          return this.finish(startedAt, request.tool, await this.runCommand(request));
        case 'git.branch':
        case 'git.commit':
        case 'github.pr':
          return this.finish(startedAt, request.tool, {
            status: 'denied',
            summary: `${request.tool} is defined but requires an approval-backed delivery adapter.`,
            reasonCode: 'delivery-adapter-required',
            mutatedPaths: [],
          });
      }
    } catch (error) {
      if (error instanceof ToolPolicyError) {
        return this.finish(startedAt, request.tool, {
          status: 'denied',
          summary: error.message,
          reasonCode: error.reasonCode,
          mutatedPaths: [],
        });
      }

      return this.finish(startedAt, request.tool, {
        status: 'failure',
        summary: `${request.tool} failed.`,
        reasonCode: 'tool-execution-failed',
        error: error instanceof Error ? error.message : String(error),
        mutatedPaths: [],
      });
    }
  }

  async checkReadiness(): Promise<{ available: boolean; message: string }> {
    try {
      const stats = await fs.stat(this.workspaceRoot);
      if (!stats.isDirectory()) {
        return { available: false, message: `Tool runtime workspace is not a directory: ${this.workspaceRoot}` };
      }

      return {
        available: true,
        message: `Tool runtime ready with ${this.commandAllowlist.length} allowlisted command pattern(s).`,
      };
    } catch (error) {
      return {
        available: false,
        message: `Tool runtime workspace is unavailable: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  private async searchRepo(request: RepoSearchRequest): Promise<Partial<EngineeringToolResult>> {
    const query = request.query.trim();
    if (!query) {
      return {
        status: 'denied',
        summary: 'Search query must be non-empty.',
        reasonCode: 'invalid-query',
        mutatedPaths: [],
      };
    }

    const maxResults = Math.min(request.maxResults ?? this.maxSearchResults, this.maxSearchResults);
    const results: string[] = [];

    for await (const filePath of this.walkFiles(this.workspaceRoot)) {
      const relativePath = this.toRelativePath(filePath);
      if (this.isProtectedPath(relativePath)) {
        continue;
      }

      const content = await this.readTextWithinLimit(filePath, this.maxReadBytes);
      const lines = content.split(/\r?\n/);
      for (const [index, line] of lines.entries()) {
        if (line.includes(query)) {
          results.push(`${relativePath}:${index + 1}:${line.trim()}`);
          if (results.length >= maxResults) {
            return {
              status: 'success',
              summary: `Found ${results.length} result(s).`,
              output: results.join('\n'),
              mutatedPaths: [],
            };
          }
        }
      }
    }

    return {
      status: 'success',
      summary: `Found ${results.length} result(s).`,
      output: results.join('\n'),
      mutatedPaths: [],
    };
  }

  private async readFile(request: FileReadRequest): Promise<Partial<EngineeringToolResult>> {
    const targetPath = this.resolveWorkspacePath(request.path);
    const relativePath = this.toRelativePath(targetPath);
    if (this.isProtectedPath(relativePath)) {
      return {
        status: 'denied',
        summary: `Refusing to read protected path: ${relativePath}`,
        reasonCode: 'protected-path',
        mutatedPaths: [],
      };
    }

    const maxBytes = Math.min(request.maxBytes ?? this.maxReadBytes, this.maxReadBytes);
    const content = await this.readTextWithinLimit(targetPath, maxBytes);
    const lines = content.split(/\r?\n/);
    const startLine = Math.max(1, request.startLine ?? 1);
    const endLine = Math.min(lines.length, request.endLine ?? lines.length);
    const selectedLines = lines.slice(startLine - 1, endLine);

    return {
      status: 'success',
      summary: `Read ${relativePath}:${startLine}-${endLine}.`,
      output: selectedLines.join('\n'),
      mutatedPaths: [],
    };
  }

  private async applyPatch(request: PatchApplyRequest): Promise<Partial<EngineeringToolResult>> {
    const touchedPaths = this.extractPatchPaths(request.patch);
    if (touchedPaths.length === 0) {
      return {
        status: 'denied',
        summary: 'Patch did not contain any file paths.',
        reasonCode: 'patch-no-paths',
        mutatedPaths: [],
      };
    }

    for (const touchedPath of touchedPaths) {
      const resolvedPath = this.resolveWorkspacePath(touchedPath);
      const relativePath = this.toRelativePath(resolvedPath);
      if (this.isProtectedPath(relativePath)) {
        return {
          status: 'denied',
          summary: `Refusing to patch protected path: ${relativePath}`,
          reasonCode: 'protected-path',
          mutatedPaths: [],
        };
      }
    }

    const patchRisk = this.assessPatchRisk(request.patch, touchedPaths);

    const check = await this.runProcess('git', ['apply', '--check', '--whitespace=nowarn', '-'], {
      cwd: this.workspaceRoot,
      input: request.patch,
      timeoutMs: this.commandTimeoutMs,
    });
    if (check.exitCode !== 0) {
      return {
        status: 'failure',
        summary: 'Patch failed validation.',
        reasonCode: 'patch-check-failed',
        error: check.output,
        exitCode: check.exitCode,
        mutatedPaths: [],
      };
    }

    if (this.dryRun || request.dryRun) {
      return {
        status: 'dry_run',
        summary: `Patch validated for ${touchedPaths.length} file(s).${patchRisk.requiresApproval ? ` Approval will be required to apply: ${patchRisk.reasons.join('; ')}` : ''}`,
        reasonCode: 'dry-run-only',
        output: check.output,
        mutatedPaths: touchedPaths,
      };
    }

    if (patchRisk.requiresApproval && !request.approvalId) {
      return {
        status: 'denied',
        summary: `Patch requires approval before apply: ${patchRisk.reasons.join('; ')}`,
        reasonCode: 'approval-required',
        output: JSON.stringify({
          touchedPaths,
          changedLines: patchRisk.changedLines,
          reasons: patchRisk.reasons,
        }),
        mutatedPaths: touchedPaths,
      };
    }

    const applied = await this.runProcess('git', ['apply', '--whitespace=nowarn', '-'], {
      cwd: this.workspaceRoot,
      input: request.patch,
      timeoutMs: this.commandTimeoutMs,
    });

    return {
      status: applied.exitCode === 0 ? 'success' : 'failure',
      summary: applied.exitCode === 0
        ? `Patch applied to ${touchedPaths.length} file(s).`
        : 'Patch application failed.',
      reasonCode: applied.exitCode === 0 ? undefined : 'patch-apply-failed',
      output: applied.output,
      error: applied.exitCode === 0 ? undefined : applied.output,
      exitCode: applied.exitCode,
      mutatedPaths: applied.exitCode === 0 ? touchedPaths : [],
    };
  }

  private async runCommand(request: CommandRunRequest): Promise<Partial<EngineeringToolResult>> {
    const args = request.args ?? [];
    if (!this.isAllowedCommand(request.command, args)) {
      return {
        status: 'denied',
        summary: `Command is not allowlisted: ${[request.command, ...args].join(' ')}`,
        reasonCode: 'command-not-allowlisted',
        mutatedPaths: [],
      };
    }

    const cwd = request.cwd
      ? this.resolveWorkspacePath(request.cwd)
      : this.workspaceRoot;
    const timeoutMs = Math.min(request.timeoutMs ?? this.commandTimeoutMs, this.commandTimeoutMs);
    const result = await this.runProcess(resolveCommandForPlatform(request.command), args, { cwd, timeoutMs });

    return {
      status: result.exitCode === 0 ? 'success' : 'failure',
      summary: result.exitCode === 0
        ? `Command succeeded: ${[request.command, ...args].join(' ')}`
        : `Command failed: ${[request.command, ...args].join(' ')}`,
      reasonCode: result.exitCode === 0 ? undefined : 'command-failed',
      output: result.output,
      error: result.exitCode === 0 ? undefined : result.output,
      exitCode: result.exitCode,
      mutatedPaths: [],
    };
  }

  private async runProcess(
    command: string,
    args: string[],
    options: { cwd: string; input?: string; timeoutMs: number }
  ): Promise<{ exitCode: number; output: string }> {
    const doSpawn = (cmd: string, argsList: string[]) =>
      new Promise<{ exitCode: number; output: string }>((resolve, reject) => {
        const child = spawn(cmd, argsList, {
          cwd: options.cwd,
          shell: false,
          windowsHide: true,
        });
        let output = '';
        let settled = false;

        const timeout = setTimeout(() => {
          if (settled) {
            return;
          }

          settled = true;
          child.kill();
          resolve({
            exitCode: -1,
            output: this.truncateOutput(`${output}\nCommand timed out after ${options.timeoutMs}ms.`),
          });
        }, options.timeoutMs);

        child.stdout.on('data', (chunk: Buffer) => {
          output = this.truncateOutput(output + chunk.toString('utf-8'));
        });
        child.stderr.on('data', (chunk: Buffer) => {
          output = this.truncateOutput(output + chunk.toString('utf-8'));
        });
        child.on('error', (error: NodeJS.ErrnoException) => {
          if (settled) {
            return;
          }

          settled = true;
          clearTimeout(timeout);
          reject(error);
        });
        child.on('close', (code) => {
          if (settled) {
            return;
          }

          settled = true;
          clearTimeout(timeout);
          resolve({ exitCode: code ?? 0, output: this.truncateOutput(output) });
        });

        if (options.input !== undefined) {
          child.stdin.end(options.input);
        }
      });

    try {
      return await doSpawn(command, args);
    } catch (firstError) {
      // On Windows, trying to spawn 'npm' can result in ENOENT even when npm.cmd exists.
      // Retry by appending '.cmd' for common executables when appropriate.
      const isWindows = process.platform === 'win32';
      const err = firstError as NodeJS.ErrnoException;
      if (isWindows) {
        // If the initial spawn failed, try common Windows fallbacks:
        // 1) append .cmd to the command (e.g., npm -> npm.cmd)
        // 2) spawn via shell (cmd.exe) with the full command line
        try {
          const tryCmd = `${command}.cmd`;
          return await doSpawn(tryCmd, args);
        } catch {
          // try shell fallback
          try {
            const cmdLine = [command, ...args].join(' ');
            return await new Promise<{ exitCode: number; output: string }>((resolve) => {
              const child = spawn(cmdLine, { cwd: options.cwd, shell: true, windowsHide: true });
              let output = '';
              const timeout = setTimeout(() => {
                child.kill();
                resolve({ exitCode: -1, output: `Command timed out after ${options.timeoutMs}ms.` });
              }, options.timeoutMs);
              child.stdout?.on('data', (c: Buffer) => (output += c.toString('utf8')));
              child.stderr?.on('data', (c: Buffer) => (output += c.toString('utf8')));
              child.on('close', (code) => {
                clearTimeout(timeout);
                resolve({ exitCode: code ?? 0, output: this.truncateOutput(output) });
              });
            });
          } catch (secondError) {
            return { exitCode: -1, output: String(secondError instanceof Error ? secondError.message : secondError) };
          }
        }
      }

      return { exitCode: -1, output: String(err instanceof Error ? err.message : err) };
    }
  }

  private isAllowedCommand(command: string, args: string[]): boolean {
    const normalizedCommand = normalizeCommandForPolicy(command);
    return this.commandAllowlist.some((entry) =>
      normalizeCommandForPolicy(entry.command) === normalizedCommand &&
      entry.args.length === args.length &&
      entry.args.every((expectedArg, index) => expectedArg === args[index])
    );
  }

  private extractPatchPaths(patch: string): string[] {
    const paths = new Set<string>();
    for (const line of patch.split(/\r?\n/)) {
      const match = line.match(/^(?:\+\+\+|---) [ab]\/(.+)$/);
      if (match && match[1] !== '/dev/null') {
        paths.add(match[1]);
      }
    }

    return [...paths];
  }

  private assessPatchRisk(patch: string, touchedPaths: string[]): PatchRiskAssessment {
    const changedLines = patch
      .split(/\r?\n/)
      .filter((line) => /^(?:\+|-)/.test(line) && !/^(?:\+\+\+|---)/.test(line)).length;
    const createsOrDeletes = /^(?:---|\+\+\+) \/dev\/null$/m.test(patch);
    const reasons: string[] = [];

    if (touchedPaths.length > this.maxSafePatchPaths) {
      reasons.push(`patch touches ${touchedPaths.length} files`);
    }

    if (changedLines > this.maxSafePatchChangedLines) {
      reasons.push(`patch changes ${changedLines} lines`);
    }

    if (createsOrDeletes) {
      reasons.push('patch creates or deletes files');
    }

    return {
      requiresApproval: reasons.length > 0,
      changedLines,
      reasons,
    };
  }

  private async *walkFiles(directory: string): AsyncGenerator<string> {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!ignoredDirectoryNames.has(entry.name)) {
          yield* this.walkFiles(fullPath);
        }
      } else if (entry.isFile()) {
        yield fullPath;
      }
    }
  }

  private async readTextWithinLimit(filePath: string, maxBytes: number): Promise<string> {
    const handle = await fs.open(filePath, 'r');
    try {
      const buffer = Buffer.alloc(maxBytes);
      const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
      return buffer.subarray(0, bytesRead).toString('utf-8');
    } finally {
      await handle.close();
    }
  }

  private resolveWorkspacePath(candidatePath: string): string {
    const resolvedPath = path.resolve(this.workspaceRoot, candidatePath);
    const relativePath = path.relative(this.workspaceRoot, resolvedPath);
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      throw new ToolPolicyError('path-escapes-workspace', `Path escapes workspace: ${candidatePath}`);
    }

    return resolvedPath;
  }

  private toRelativePath(absolutePath: string): string {
    return path.relative(this.workspaceRoot, absolutePath).replace(/\\/g, '/');
  }

  private isProtectedPath(relativePath: string): boolean {
    const normalizedPath = relativePath.replace(/\\/g, '/');
    return this.protectedPathPrefixes.some((prefix) => {
      const normalizedPrefix = prefix.replace(/\\/g, '/');
      return normalizedPath === normalizedPrefix || normalizedPath.startsWith(`${normalizedPrefix}/`);
    });
  }

  private truncateOutput(output: string): string {
    if (output.length <= this.maxOutputBytes) {
      return output;
    }

    return `${output.slice(0, this.maxOutputBytes)}\n[output truncated]`;
  }

  private finish(
    startedAt: Date,
    tool: EngineeringToolName,
    partial: Partial<EngineeringToolResult>
  ): EngineeringToolResult {
    return {
      id: `tool_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
      tool,
      status: partial.status ?? 'failure',
      startedAt,
      endedAt: new Date(),
      summary: partial.summary ?? `${tool} completed.`,
      reasonCode: partial.reasonCode,
      output: partial.output,
      error: partial.error,
      exitCode: partial.exitCode,
      mutatedPaths: partial.mutatedPaths ?? [],
    };
  }
}
