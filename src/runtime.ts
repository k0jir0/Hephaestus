import fs from 'fs/promises';
import { config as defaultConfig, type Config } from './config.js';
import {
  AdmissionController,
  createBackendAdmissionGate,
  createRepositoryAdmissionGate,
  createSafetyAdmissionGate,
  createToolRuntimeAdmissionGate,
  type AdmissionDecision,
} from './admission.js';
import { AIExecutor } from './executor.js';
import { logger } from './logger.js';
import { AgentMemory } from './memory.js';
import { formatTaskPlanSummary } from './plan-contract.js';
import type { PreflightResult } from './preflight.js';
import { runStartupPreflight } from './preflight.js';
import type {
  MemoryRepository,
  PendingTaskSideEffect,
  RepositoryReadinessProbe,
  TaskArtifactRepository,
  TaskRepository,
  TaskSideEffectRepository,
  ToolRuntimeReadinessProbe,
} from './repositories.js';
import { SafetySystem } from './safety.js';
import { transitionTask } from './task-lifecycle.js';
import { TicketStoreRepository } from './task-store.js';
import { EngineeringToolRuntime, type EngineeringToolRequest } from './tool-runtime.js';
import type { AIResponse, AgentState, EngineeringToolResult, Task, TaskPlan } from './types.js';

export interface RuntimeOptions {
  runOnce?: boolean;
  preflightOnly?: boolean;
}

export interface RuntimeExecutorPort {
  executeTask(task: Task, context?: string): Promise<AIResponse>;
  checkHealth(): Promise<{ available: boolean; message: string }>;
}

export interface RuntimeSafetyPort {
  shouldContinue(): Promise<{ allowed: boolean; reason?: string }>;
  recordSuccess(): void;
  recordError(error: string): void;
  recordTaskCompletion(): void;
  recordTokenUsage(promptTokens: number, completionTokens: number, cost: number): void;
  shouldAutoCommit(): boolean;
  performAutoCommit(message?: string): Promise<boolean>;
  getStatusSummary(): string;
  resetDailyCounters(): void;
}

export interface RuntimeToolPort extends ToolRuntimeReadinessProbe {
  execute?(request: EngineeringToolRequest): Promise<EngineeringToolResult>;
}

export interface RuntimeDependencies {
  config?: Config;
  memory?: MemoryRepository;
  tasks?: TaskRepository;
  watcher?: TaskRepository;
  executor?: RuntimeExecutorPort;
  safety?: RuntimeSafetyPort;
  toolRuntime?: RuntimeToolPort;
  admissionController?: AdmissionController;
  preflightRunner?: (executor: RuntimeExecutorPort) => Promise<PreflightResult>;
  contextProvider?: () => Promise<string>;
}

function createInitialState(): AgentState {
  return {
    status: 'idle',
    iterationCount: 0,
    totalTasksCompleted: 0,
    consecutiveErrors: 0,
    lastActivity: new Date(),
    sessionStart: new Date(),
    tokenUsage: {
      promptTokens: 0,
      completionTokens: 0,
      totalCost: 0,
    },
  };
}

export class HephaestusRuntime {
  private readonly runtimeConfig: Config;
  private readonly memory: MemoryRepository;
  private readonly tasks: TaskRepository;
  private readonly executor: RuntimeExecutorPort;
  private readonly safety: RuntimeSafetyPort;
  private readonly toolRuntime: RuntimeToolPort;
  private readonly admissionController: AdmissionController;
  private readonly preflightRunner: (executor: RuntimeExecutorPort) => Promise<PreflightResult>;
  private readonly contextProvider: () => Promise<string>;
  private readonly state: AgentState = createInitialState();
  private isShuttingDown = false;
  private statusInterval: NodeJS.Timeout | null = null;
  private watchModeResolver: (() => void) | null = null;
  private budgetWindowDay = new Date().toDateString();
  private executionPauseReason: string | null = null;

  constructor(dependencies: RuntimeDependencies = {}) {
    this.runtimeConfig = dependencies.config ?? defaultConfig;
    this.memory = dependencies.memory ?? new AgentMemory(this.runtimeConfig.agentMemoryFile);
    this.tasks =
      dependencies.tasks ??
      dependencies.watcher ??
      new TicketStoreRepository({
        tasksFile: this.runtimeConfig.tasksFile,
        storeFile: this.runtimeConfig.ticketStoreFile,
        allowMarkdownFallback: this.runtimeConfig.allowMarkdownTaskFallback,
        projectionEnabled: this.runtimeConfig.taskBoardProjectionEnabled,
      });
    this.executor = dependencies.executor ?? new AIExecutor({ config: this.runtimeConfig });
    this.safety =
      dependencies.safety ??
      new SafetySystem({
        safetyConfig: this.runtimeConfig.safety,
        targetProject: this.runtimeConfig.targetProject,
      });
    this.toolRuntime =
      dependencies.toolRuntime ??
      new EngineeringToolRuntime({
        workspaceRoot: this.runtimeConfig.targetProject,
        dryRun: true,
      });
    this.admissionController =
      dependencies.admissionController ??
      new AdmissionController([
        createSafetyAdmissionGate(this.safety),
        createBackendAdmissionGate(this.executor),
        ...('getRepositoryReadiness' in this.tasks
          ? [createRepositoryAdmissionGate(this.tasks as TaskRepository & RepositoryReadinessProbe)]
          : []),
        createToolRuntimeAdmissionGate(this.toolRuntime),
      ]);
    this.preflightRunner =
      dependencies.preflightRunner ??
      (async (executor) =>
        runStartupPreflight({ config: this.runtimeConfig, healthChecker: executor }));
    this.contextProvider = dependencies.contextProvider ?? (() => this.getProjectContext());
  }

  async run(options: RuntimeOptions = {}): Promise<void> {
    await this.memory.initialize();
    await this.memory.updateStatus('Starting');

    const preflight = await this.preflightRunner(this.executor);
    await this.handlePreflight(preflight);

    if (options.preflightOnly) {
      await this.memory.addSessionSummary('Startup preflight passed');
      await this.memory.updateStatus('Idle', 'None');
      logger.info('Preflight mode complete');
      return;
    }

    this.logConfiguration(options);

    if (this.executionPauseReason) {
      await this.enterPausedMode(this.executionPauseReason);

      if (options.runOnce) {
        await this.tasks.stop();
        logger.info('Single-pass mode paused before execution');
        return;
      }

      this.startStatusLoop(this.executionPauseReason);
      await new Promise<void>((resolve) => {
        this.watchModeResolver = resolve;
      });
      return;
    }

    if (options.runOnce) {
      await this.runSinglePass();
      return;
    }

    await this.tasks.start(async (task: Task) => {
      if (this.isShuttingDown) {
        return;
      }

      await this.processTask(task);
    });

    this.startStatusLoop();
    await this.memory.addSessionSummary('Agent started successfully');

    await new Promise<void>((resolve) => {
      this.watchModeResolver = resolve;
    });
  }

  async shutdown(signal: string): Promise<void> {
    if (this.isShuttingDown) {
      return;
    }

    this.isShuttingDown = true;
    this.state.status = 'shutdown';
    this.state.currentTask = undefined;
    this.state.lastActivity = new Date();
    logger.info(`Received ${signal}, shutting down gracefully...`);

    if (this.statusInterval) {
      clearInterval(this.statusInterval);
      this.statusInterval = null;
    }

    await this.tasks.stop();
    logger.info('Final status:');
    logger.info(this.safety.getStatusSummary());

    await this.memory.addSessionSummary(`Agent shutdown: ${signal}`);
    await this.memory.updateStatus('Shutdown');

    if (this.watchModeResolver) {
      const resolve = this.watchModeResolver;
      this.watchModeResolver = null;
      resolve();
    }

    logger.info('Shutdown complete. Goodbye!');
  }

  private async handlePreflight(preflight: PreflightResult): Promise<void> {
    this.executionPauseReason = null;

    for (const issue of preflight.issues) {
      if (issue.severity === 'error') {
        logger.error(`Preflight ${issue.code}: ${issue.message}`);
        continue;
      }

      logger.warn(`Preflight ${issue.code}: ${issue.message}`);
    }

    if (preflight.issues.some((issue) => issue.code === 'backend-unavailable')) {
      this.executionPauseReason = preflight.issues
        .filter((issue) => issue.code === 'backend-unavailable')
        .map((issue) => issue.message)
        .join('; ');
      logger.warn('Agent will pause task execution until backend readiness is restored');
    }

    if (!preflight.ok) {
      const reasons = preflight.issues
        .filter((issue) => issue.severity === 'error')
        .map((issue) => issue.message)
        .join('; ');

      this.state.status = 'blocked';
      this.state.lastActivity = new Date();
      await this.memory.recordBlocker('Startup preflight', reasons);
      await this.memory.addSessionSummary('Startup preflight failed');
      await this.memory.updateStatus('Blocked', 'Startup preflight');
      throw new Error('Startup preflight failed');
    }

    if (preflight.issues.length === 0) {
      logger.info('Startup preflight passed with no issues');
    } else {
      logger.info('Startup preflight passed with warnings');
    }
  }

  private logConfiguration(options: RuntimeOptions): void {
    logger.info(`AI Backend: ${this.runtimeConfig.aiBackend}`);
    logger.info(`Model: ${this.runtimeConfig.aiModel || 'default'}`);
    logger.info(`Target Project: ${this.runtimeConfig.targetProject}`);
    logger.info(`Daily Budget: $${this.runtimeConfig.safety.dailyTokenBudget}`);
    logger.info(`Max Iterations: ${this.runtimeConfig.safety.maxIterations}`);
    logger.info(`Check Interval: ${this.runtimeConfig.checkInterval / 1000}s`);
    logger.info(`Mode: ${options.runOnce ? 'single-pass' : 'watch'}`);
  }

  private async enterPausedMode(reason: string): Promise<void> {
    this.state.status = 'paused';
    this.state.currentTask = undefined;
    this.state.lastActivity = new Date();

    logger.warn(`Execution paused: ${reason}`);
    await this.memory.addSessionSummary(`Paused: ${reason}`);
    await this.memory.updateStatus('Paused', reason);
  }

  private async runSinglePass(): Promise<void> {
    const pendingTasks = await this.tasks.getPendingTasks();

    if (pendingTasks.length === 0) {
      logger.info('No pending tasks found. Exiting single-pass mode.');
      await this.memory.addSessionSummary('Single-pass run found no pending tasks');
      await this.memory.updateStatus('Idle', 'None');
      await this.tasks.stop();
      return;
    }

    for (const task of pendingTasks) {
      if (this.isShuttingDown) {
        break;
      }

      const outcome = await this.processTask(task);
      if (outcome === 'rejected') {
        continue;
      }
    }

    await this.memory.addSessionSummary('Single-pass run complete');

    if (this.state.status !== 'blocked') {
      await this.memory.updateStatus('Idle', 'None');
    }

    await this.tasks.stop();
    logger.info('Single-pass mode complete');
  }

  private startStatusLoop(pauseReason?: string): void {
    this.statusInterval = setInterval(() => {
      void this.handlePeriodicStatus();
    }, this.runtimeConfig.checkInterval);

    logger.info('='.repeat(50));
    if (pauseReason) {
      logger.info('Hephaestus is paused and preserving queued work');
      logger.info(`Pause reason: ${pauseReason}`);
      logger.info('Restore backend readiness and restart the agent to resume execution');
    } else {
      logger.info('Hephaestus is running and watching the ticket store');
      logger.info('Create work with: npm run tickets -- create "<task>"');
      logger.info('Press Ctrl+C to stop');
    }
    logger.info('='.repeat(50));
  }

  private async handlePeriodicStatus(): Promise<void> {
    if (this.isShuttingDown) {
      return;
    }

    logger.info('Periodic status check');
    logger.info(this.safety.getStatusSummary());

    if (this.safety.shouldAutoCommit()) {
      await this.safety.performAutoCommit();
    }

    const currentDay = new Date().toDateString();
    if (currentDay !== this.budgetWindowDay) {
      logger.info('New day detected, resetting daily counters');
      this.safety.resetDailyCounters();
      this.budgetWindowDay = currentDay;
    }
  }

  private async processTask(task: Task): Promise<'completed' | 'failed' | 'rejected'> {
    if (this.isShuttingDown) {
      return 'rejected';
    }

    let taskMarkedInProgress = false;

    try {
      const admission = await this.admissionController.evaluate(task);
      if (!admission.allowed) {
        this.logAdmissionDecision(task, admission);
        this.state.status = 'blocked';
        this.state.currentTask = undefined;
        this.state.lastActivity = new Date();
        await this.memory.recordBlocker(
          task.description,
          `${admission.reason} [${admission.correlationId}]`
        );
        await this.memory.updateStatus('Blocked', task.description);
        return 'rejected';
      }

      this.logAdmissionDecision(task, admission);

      logger.info(`Processing task: ${task.description}`);
      this.state.status = 'working';
      this.state.currentTask = task;
      this.state.lastActivity = new Date();
      await this.memory.updateStatus('Working', task.description);
      Object.assign(task, transitionTask(task, 'in_progress'));
      await this.tasks.markTaskInProgress(task);
      taskMarkedInProgress = true;

      const context = await this.contextProvider();
      const result = await this.executor.executeTask(task, context);

      if (result.success) {
        const taskSummary = formatTaskPlanSummary(result.plan ?? {
          summary: result.content,
          intendedFiles: [],
          commands: [],
          verification: ['Review model output manually.'],
          risks: [],
        });
        Object.assign(task, transitionTask(task, 'completed'));
        task.plan = result.plan;
        task.result = taskSummary;

        const toolArtifacts = await this.executePlannedTools(task, result.plan, admission.correlationId);
        await this.appendTaskArtifacts(task.id, toolArtifacts);

        await this.tasks.markTaskCompleted(task);
        this.recordSuccessfulTask(task, result);
        await this.recordCompletionSideEffects(task, taskSummary, admission.correlationId);

        logger.info(`Task planned successfully: ${task.description}`);
        logger.info(result.content, {
          plannedFiles: result.plan?.intendedFiles.length ?? 0,
          plannedCommands: result.plan?.commands.length ?? 0,
        });

        await this.markIdle();
        return 'completed';
      }

      logger.error(`Task failed: ${task.description}`, { error: result.content });
      task.error = result.content;
      await this.handleBlockedTask(task, result.content, taskMarkedInProgress);
      return 'failed';
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Task processing error', { error: errorMessage });
      task.error = errorMessage;
      await this.handleBlockedTask(task, errorMessage, taskMarkedInProgress);
      return 'failed';
    }
  }

  private logAdmissionDecision(task: Task, admission: AdmissionDecision): void {
    for (const issue of admission.issues.filter((candidate) => candidate.severity === 'warning')) {
      logger.warn(`Admission warning [${admission.correlationId}] ${issue.code}: ${issue.message}`, {
        task: task.description,
      });
    }

    if (!admission.allowed) {
      logger.warn(`Admission check failed [${admission.correlationId}]: ${admission.reason}`);
    }
  }

  private recordSuccessfulTask(task: Task, result: AIResponse): void {
    this.safety.recordSuccess();
    this.safety.recordTaskCompletion();
    this.state.totalTasksCompleted++;

    if (result.cost !== undefined && result.tokens) {
      this.safety.recordTokenUsage(
        result.tokens.prompt,
        result.tokens.completion,
        result.cost
      );
    }

    if (this.safety.shouldAutoCommit()) {
      void this.safety.performAutoCommit();
    }

    this.state.currentTask = task;
    this.state.lastActivity = new Date();
  }

  private async recordCompletionSideEffects(
    task: Task,
    taskSummary: string,
    correlationId: string
  ): Promise<void> {
    await this.runDurableMemorySideEffects(task, [
      {
        type: 'memory.record-task-completion',
        payload: { result: taskSummary },
        idempotencyKey: `${correlationId}:memory.record-task-completion`,
        correlationId,
        execute: () => this.memory.recordTaskCompletion(task, taskSummary),
      },
      {
        type: 'memory.add-task-history',
        payload: { result: 'Plan ready' },
        idempotencyKey: `${correlationId}:memory.add-task-history`,
        correlationId,
        execute: () => this.memory.addToTaskHistory(task, 'Plan ready'),
      },
      {
        type: 'memory.add-session-summary',
        payload: { summary: `Planned: ${task.description}` },
        idempotencyKey: `${correlationId}:memory.add-session-summary`,
        correlationId,
        execute: () => this.memory.addSessionSummary(`Planned: ${task.description}`),
      },
    ]);
  }

  private async runDurableMemorySideEffects(
    task: Task,
    sideEffects: Array<
      PendingTaskSideEffect & {
        execute: () => Promise<void>;
      }
    >
  ): Promise<void> {
    const repository = this.getTaskSideEffectRepository();
    const persistedSideEffects = repository
      ? await repository.enqueueTaskSideEffects(
          task.id,
          sideEffects.map(({ type, payload, idempotencyKey, correlationId, attemptId }) => ({
            type,
            payload,
            idempotencyKey,
            correlationId,
            attemptId,
          }))
        )
      : [];

    for (const [index, sideEffect] of sideEffects.entries()) {
      const persisted = persistedSideEffects[index];

      try {
        await sideEffect.execute();
        if (repository && persisted) {
          await repository.markTaskSideEffectProcessed(persisted.id);
        }
      } catch (error) {
        if (repository && persisted) {
          await repository.markTaskSideEffectFailed(persisted.id, String(error));
        }
        logger.error(`Non-fatal memory side effect failed: ${sideEffect.type}`, {
          error: String(error),
          ticketId: task.id,
          correlationId: sideEffect.correlationId,
        });
      }
    }
  }

  private getTaskSideEffectRepository(): (TaskRepository & TaskSideEffectRepository) | null {
    return 'enqueueTaskSideEffects' in this.tasks
      ? (this.tasks as TaskRepository & TaskSideEffectRepository)
      : null;
  }

  private getTaskArtifactRepository(): (TaskRepository & TaskArtifactRepository) | null {
    return 'appendTaskAttemptArtifacts' in this.tasks
      ? (this.tasks as TaskRepository & TaskArtifactRepository)
      : null;
  }

  private async executePlannedTools(
    task: Task,
    plan: TaskPlan | undefined,
    correlationId: string
  ): Promise<string[]> {
    if (!plan || !this.toolRuntime.execute) {
      return [];
    }

    const artifacts: string[] = [];

    for (const file of plan.intendedFiles) {
      if (file.changeType !== 'inspect') {
        artifacts.push(
          `[${correlationId}] deferred-mutation ${file.changeType} ${file.path}: mutating file plans require approval-backed patch generation.`
        );
        continue;
      }

      const result = await this.toolRuntime.execute({
        tool: 'file.read',
        path: file.path,
        maxBytes: 8 * 1024,
      });
      artifacts.push(this.formatToolArtifact(correlationId, 'file.read', file.path, result));
    }

    for (const commandPlan of plan.commands) {
      const parsedCommand = this.parseCommandPlan(commandPlan.command);
      if (!parsedCommand) {
        artifacts.push(
          `[${correlationId}] denied command.parse for "${commandPlan.command}": command string could not be tokenized safely.`
        );
        continue;
      }

      const result = await this.toolRuntime.execute({
        tool: 'command.run',
        command: parsedCommand.command,
        args: parsedCommand.args,
      });
      artifacts.push(
        this.formatToolArtifact(correlationId, 'command.run', commandPlan.command, result)
      );
    }

    logger.info('Executed bounded plan tools', {
      ticketId: task.id,
      correlationId,
      artifactCount: artifacts.length,
    });

    return artifacts;
  }

  private async appendTaskArtifacts(ticketId: string, artifacts: string[]): Promise<void> {
    const repository = this.getTaskArtifactRepository();
    if (!repository || artifacts.length === 0) {
      return;
    }

    try {
      await repository.appendTaskAttemptArtifacts(ticketId, artifacts);
    } catch (error) {
      logger.warn('Could not persist task attempt artifacts', {
        ticketId,
        error: String(error),
      });
    }
  }

  private formatToolArtifact(
    correlationId: string,
    tool: EngineeringToolRequest['tool'],
    subject: string,
    result: EngineeringToolResult
  ): string {
    const reasonCodeSuffix = result.reasonCode ? ` [${result.reasonCode}]` : '';
    return `[${correlationId}] ${tool} ${subject} -> ${result.status}${reasonCodeSuffix}: ${result.summary}`;
  }

  private parseCommandPlan(command: string): { command: string; args: string[] } | null {
    const tokens = command.match(/(?:"[^"]*"|'[^']*'|\S)+/g);
    if (!tokens || tokens.length === 0) {
      return null;
    }

    const normalizeToken = (token: string) => token.replace(/^['"]|['"]$/g, '');
    const [binary, ...args] = tokens.map(normalizeToken);
    if (!binary) {
      return null;
    }

    return { command: binary, args };
  }

  private async markIdle(): Promise<void> {
    this.state.status = 'idle';
    this.state.currentTask = undefined;
    this.state.lastActivity = new Date();
    await this.memory.updateStatus('Idle', 'None');
  }

  private async handleBlockedTask(
    task: Task,
    reason: string,
    taskMarkedInProgress: boolean
  ): Promise<void> {
    this.safety.recordError(reason);
    this.state.status = 'blocked';
    this.state.currentTask = task;
    this.state.lastActivity = new Date();

    const correlationId = `blocked_${task.id}_${Date.now()}`;
    await this.runDurableMemorySideEffects(task, [
      {
        type: 'memory.record-blocker',
        payload: { reason },
        idempotencyKey: `${correlationId}:memory.record-blocker`,
        correlationId,
        execute: () => this.memory.recordBlocker(task.description, reason),
      },
      {
        type: 'memory.add-session-summary',
        payload: { summary: `Blocked: ${task.description}` },
        idempotencyKey: `${correlationId}:memory.add-session-summary`,
        correlationId,
        execute: () => this.memory.addSessionSummary(`Blocked: ${task.description}`),
      },
    ]);
    await this.memory.updateStatus('Blocked', task.description);

    if (taskMarkedInProgress) {
      Object.assign(task, transitionTask(task, 'blocked'));
      await this.tasks.markTaskBlocked(task);
    }
  }

  private async getProjectContext(): Promise<string> {
    try {
      const contextParts: string[] = [];

      try {
        const packageJson = await fs.readFile(
          `${this.runtimeConfig.targetProject}/package.json`,
          'utf-8'
        );
        const pkg = JSON.parse(packageJson) as { name?: string; scripts?: Record<string, string> };
        contextParts.push(`Project: ${pkg.name || 'unknown'}`);
        contextParts.push(`Scripts: ${Object.keys(pkg.scripts || {}).join(', ')}`);
      } catch {
        // Ignore if no package.json
      }

      try {
        const readme = await fs.readFile(
          `${this.runtimeConfig.targetProject}/README.md`,
          'utf-8'
        );
        const lines = readme.split('\n').slice(0, 20);
        contextParts.push(`README (excerpt):\n${lines.join('\n')}`);
      } catch {
        // Ignore if no README
      }

      try {
        const { exec } = await import('child_process');
        const { promisify } = await import('util');
        const execAsync = promisify(exec);
        const { stdout } = await execAsync('git status --short', {
          cwd: this.runtimeConfig.targetProject,
        });
        if (stdout.trim()) {
          contextParts.push(`Git status:\n${stdout}`);
        }
      } catch {
        // Ignore if not a git repo
      }

      return contextParts.join('\n\n');
    } catch (error) {
      logger.warn('Could not get project context', {
        error: String(error),
      });
      return '';
    }
  }
}
