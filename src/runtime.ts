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
import { SelfAuditSeeder, type SelfAuditSeedResult } from './self-audit.js';
import { transitionTask } from './task-lifecycle.js';
import { TicketStoreRepository } from './task-store.js';
import { EngineeringToolRuntime, type EngineeringToolRequest } from './tool-runtime.js';
import type {
  AIResponse,
  AgentState,
  EngineeringToolResult,
  Task,
  TaskApprovalState,
  TaskPlan,
  ToolCall,
  ToolPolicySnapshot,
} from './types.js';

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
  getPolicySnapshot?(): ToolPolicySnapshot;
}

export interface RuntimeSelfAuditSeeder {
  seedTickets(options?: { limit?: number; dryRun?: boolean; onlyWhenQueueEmpty?: boolean }): Promise<SelfAuditSeedResult>;
}

interface PlannedToolExecutionOutcome {
  artifacts: string[];
  failureReason?: string;
  awaitingApprovalReason?: string;
  pendingToolCalls?: ToolCall[];
  approvalState?: TaskApprovalState;
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
  selfAuditSeeder?: RuntimeSelfAuditSeeder;
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
  private readonly selfAuditSeeder: RuntimeSelfAuditSeeder | null;
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
        dryRun: this.runtimeConfig.toolRuntimeDryRun ?? false,
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
    this.selfAuditSeeder = dependencies.selfAuditSeeder ??
      (this.tasks instanceof TicketStoreRepository
        ? new SelfAuditSeeder({
            config: this.runtimeConfig,
            repository: this.tasks,
          })
        : null);
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

    await this.runStartupSelfAuditIfEnabled();

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
    logger.info(`Self-audit on startup: ${this.runtimeConfig.selfAuditOnStartup ? 'enabled' : 'disabled'}`);
    logger.info(`Tool runtime apply mode: ${this.runtimeConfig.toolRuntimeDryRun ? 'dry-run' : 'apply'}`);
    logger.info(`Mode: ${options.runOnce ? 'single-pass' : 'watch'}`);
  }

  private async runStartupSelfAuditIfEnabled(): Promise<void> {
    if (!this.runtimeConfig.selfAuditOnStartup) {
      return;
    }

    if (!this.selfAuditSeeder) {
      logger.warn('Startup self-audit is enabled, but no self-audit seeder is available');
      return;
    }

    try {
      const result = await this.selfAuditSeeder.seedTickets({
        limit: this.runtimeConfig.selfAuditMaxTickets,
        onlyWhenQueueEmpty: true,
      });
      if (result.skippedBecauseQueueActive) {
        logger.info('Startup self-audit skipped because active tickets already exist');
        await this.memory.addSessionSummary('Startup self-audit skipped because active tickets already exist');
        return;
      }

      logger.info(`Startup self-audit created ${result.created.length} ticket(s) and skipped ${result.skippedDuplicates.length} duplicate(s)`);
      await this.memory.addSessionSummary(`Startup self-audit created ${result.created.length} ticket(s)`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn('Startup self-audit failed', { error: errorMessage });
      await this.memory.addSessionSummary(`Startup self-audit failed: ${errorMessage}`);
    }
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

  private async processTask(task: Task): Promise<'completed' | 'failed' | 'rejected' | 'awaiting_approval'> {
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
      const resumedToolCalls = this.getResumableApprovedToolCalls(task);
      const result = resumedToolCalls
        ? {
            success: true,
            content: `Resume approved execution for ${task.description}.`,
            plan: task.plan,
            toolCalls: resumedToolCalls,
          } satisfies AIResponse
        : await this.executor.executeTask(task, context);

      if (result.success) {
        const taskSummary = formatTaskPlanSummary(result.plan ?? {
          summary: result.content,
          intendedFiles: [],
          commands: [],
          verification: ['Review model output manually.'],
          risks: [],
        });
        task.plan = result.plan;
        task.result = taskSummary;
        task.toolCalls = result.toolCalls;

        const toolExecution = await this.executePlannedTools(
          task,
          result.plan,
          result.toolCalls ?? [],
          admission.correlationId,
          {
            skipPlanPrelude: resumedToolCalls !== null,
          }
        );
        await this.appendTaskArtifacts(task.id, toolExecution.artifacts);

        if (toolExecution.awaitingApprovalReason) {
          task.error = toolExecution.awaitingApprovalReason;
          task.toolCalls = toolExecution.pendingToolCalls ?? result.toolCalls ?? [];
          task.approval = toolExecution.approvalState;
          Object.assign(task, transitionTask(task, 'awaiting_approval'));
          await this.handleAwaitingApprovalTask(task, toolExecution.awaitingApprovalReason, taskMarkedInProgress);
          return 'awaiting_approval';
        }

        if (toolExecution.failureReason) {
          task.error = toolExecution.failureReason;
          await this.handleBlockedTask(task, toolExecution.failureReason, taskMarkedInProgress);
          return 'failed';
        }

        Object.assign(task, transitionTask(task, 'completed'));

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
    toolCalls: ToolCall[],
    correlationId: string,
    options: { skipPlanPrelude?: boolean } = {}
  ): Promise<PlannedToolExecutionOutcome> {
    if ((!plan && toolCalls.length === 0) || !this.toolRuntime.execute) {
      return { artifacts: [] };
    }

    const artifacts: string[] = [];

    const policySnapshot = this.toolRuntime.getPolicySnapshot?.();
    if (policySnapshot) {
      artifacts.push(this.formatPolicySnapshotArtifact(correlationId, policySnapshot));
    }

    if (options.skipPlanPrelude && task.approval?.approvalId) {
      artifacts.push(
        `[${correlationId}] approval.resume ${task.approval.requestId} -> ${task.approval.approvalId}`
      );
    }

    if (plan && !options.skipPlanPrelude) {
      for (const file of plan.intendedFiles) {
        if (file.changeType !== 'inspect') {
          artifacts.push(
            `[${correlationId}] deferred-mutation ${file.changeType} ${file.path}: mutating file plans require governed tool calls.`
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

        if (result.status === 'failure' || result.status === 'denied') {
          return {
            artifacts,
            failureReason: `${result.summary}${result.error ? `: ${result.error}` : ''}`,
          };
        }
      }
    }

    for (const [index, toolCall] of toolCalls.entries()) {
      const execution = await this.executeGovernedToolCall(plan, toolCall, correlationId);
      artifacts.push(...execution.artifacts);

      if (execution.awaitingApprovalReason || execution.failureReason) {
        return {
          artifacts,
          awaitingApprovalReason: execution.awaitingApprovalReason,
          failureReason: execution.failureReason,
          approvalState: execution.approvalState,
          pendingToolCalls: execution.awaitingApprovalReason ? toolCalls.slice(index) : undefined,
        };
      }
    }

    logger.info('Executed bounded plan tools', {
      ticketId: task.id,
      correlationId,
      artifactCount: artifacts.length,
    });

    return { artifacts };
  }

  private async executeGovernedToolCall(
    plan: TaskPlan | undefined,
    toolCall: ToolCall,
    correlationId: string
  ): Promise<PlannedToolExecutionOutcome> {
    if (!this.toolRuntime.execute) {
      return { artifacts: [] };
    }

    switch (toolCall.name) {
      case 'patch.apply': {
        const patch = typeof toolCall.arguments.patch === 'string' ? toolCall.arguments.patch : null;
        const approvalId = typeof toolCall.arguments.approvalId === 'string'
          ? toolCall.arguments.approvalId
          : undefined;
        if (!patch) {
          return {
            artifacts: [
              `[${correlationId}] denied patch.apply: tool call is missing a string patch argument.`
            ],
            failureReason: 'Tool call patch.apply must provide a string patch argument.',
          };
        }

        const dryRunResult = await this.toolRuntime.execute({
          tool: 'patch.apply',
          patch,
          dryRun: true,
        });
        const patchSubject = this.describePatchSubject(dryRunResult.mutatedPaths);
        const artifacts = [
          this.formatToolArtifact(correlationId, 'patch.apply', `${patchSubject} [dry-run]`, dryRunResult),
        ];

        if (dryRunResult.status !== 'dry_run') {
          return {
            artifacts,
            failureReason: `${dryRunResult.summary}${dryRunResult.error ? `: ${dryRunResult.error}` : ''}`,
          };
        }

        const bindingError = this.validatePatchCallAgainstPlan(plan, dryRunResult.mutatedPaths);
        if (bindingError) {
          artifacts.push(`[${correlationId}] denied patch.binding ${patchSubject}: ${bindingError}`);
          return {
            artifacts,
            failureReason: bindingError,
          };
        }

        const applyResult = await this.toolRuntime.execute({
          tool: 'patch.apply',
          patch,
          approvalId,
        });
        artifacts.push(
          this.formatToolArtifact(correlationId, 'patch.apply', `${patchSubject} [apply]`, applyResult)
        );
        artifacts.push(this.formatPatchDeltaArtifact(correlationId, patchSubject, dryRunResult, applyResult));

        if (applyResult.status === 'denied' && applyResult.reasonCode === 'approval-required') {
          return {
            artifacts,
            awaitingApprovalReason: applyResult.summary,
            approvalState: this.buildApprovalState(correlationId, applyResult),
          };
        }

        if (applyResult.status === 'failure' || applyResult.status === 'denied') {
          return {
            artifacts,
            failureReason: `${applyResult.summary}${applyResult.error ? `: ${applyResult.error}` : ''}`,
          };
        }

        return { artifacts };
      }

      case 'command.run': {
        const command = typeof toolCall.arguments.command === 'string'
          ? toolCall.arguments.command
          : null;
        const args = Array.isArray(toolCall.arguments.args)
          ? toolCall.arguments.args.filter((candidate): candidate is string => typeof candidate === 'string')
          : [];
        if (!command) {
          return {
            artifacts: [`[${correlationId}] denied command.run: tool call is missing a command string.`],
            failureReason: 'Tool call command.run must provide a command string.',
          };
        }

        const bindingError = this.validateCommandCallAgainstPlan(plan, command, args);
        if (bindingError) {
          return {
            artifacts: [`[${correlationId}] denied command.binding ${command}: ${bindingError}`],
            failureReason: bindingError,
          };
        }

        const result = await this.toolRuntime.execute({
          tool: 'command.run',
          command,
          args,
        });
        const subject = [command, ...args].join(' ');
        const artifacts = [this.formatToolArtifact(correlationId, 'command.run', subject, result)];
        return result.status === 'failure' || result.status === 'denied'
          ? {
              artifacts,
              failureReason: `${result.summary}${result.error ? `: ${result.error}` : ''}`,
            }
          : { artifacts };
      }

      case 'file.read': {
        const targetPath = typeof toolCall.arguments.path === 'string'
          ? toolCall.arguments.path
          : null;
        if (!targetPath) {
          return {
            artifacts: [`[${correlationId}] denied file.read: tool call is missing a path string.`],
            failureReason: 'Tool call file.read must provide a path string.',
          };
        }

        const bindingError = this.validateReadCallAgainstPlan(plan, targetPath);
        if (bindingError) {
          return {
            artifacts: [`[${correlationId}] denied file.binding ${targetPath}: ${bindingError}`],
            failureReason: bindingError,
          };
        }

        const result = await this.toolRuntime.execute({
          tool: 'file.read',
          path: targetPath,
          startLine: typeof toolCall.arguments.startLine === 'number' ? toolCall.arguments.startLine : undefined,
          endLine: typeof toolCall.arguments.endLine === 'number' ? toolCall.arguments.endLine : undefined,
          maxBytes: typeof toolCall.arguments.maxBytes === 'number' ? toolCall.arguments.maxBytes : undefined,
        });
        const artifacts = [this.formatToolArtifact(correlationId, 'file.read', targetPath, result)];
        return result.status === 'failure' || result.status === 'denied'
          ? {
              artifacts,
              failureReason: `${result.summary}${result.error ? `: ${result.error}` : ''}`,
            }
          : { artifacts };
      }

      default:
        return {
          artifacts: [
            `[${correlationId}] denied ${toolCall.name}: governed runtime does not yet bind this tool call to the plan.`
          ],
          failureReason: `Tool call ${toolCall.name} is not yet supported by the governed runtime.`,
        };
    }
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

  private formatPolicySnapshotArtifact(
    correlationId: string,
    snapshot: ToolPolicySnapshot
  ): string {
    return `[${correlationId}] policy.snapshot [${snapshot.signature}] ${JSON.stringify({
      ...snapshot,
      generatedAt: snapshot.generatedAt.toISOString(),
    })}`;
  }

  private formatPatchDeltaArtifact(
    correlationId: string,
    subject: string,
    dryRunResult: EngineeringToolResult,
    applyResult: EngineeringToolResult
  ): string {
    const dryRunCode = dryRunResult.reasonCode ? `${dryRunResult.status}/${dryRunResult.reasonCode}` : dryRunResult.status;
    const applyCode = applyResult.reasonCode ? `${applyResult.status}/${applyResult.reasonCode}` : applyResult.status;
    return `[${correlationId}] patch.delta ${subject}: dry-run=${dryRunCode}; apply=${applyCode}; mutatedPaths=${applyResult.mutatedPaths.join(',') || dryRunResult.mutatedPaths.join(',') || '-'}`;
  }

  private describePatchSubject(mutatedPaths: string[]): string {
    if (mutatedPaths.length === 0) {
      return 'patch';
    }

    return mutatedPaths.join(', ');
  }

  private validatePatchCallAgainstPlan(
    plan: TaskPlan | undefined,
    mutatedPaths: string[]
  ): string | null {
    if (!plan) {
      return 'Patch tool calls require a validated plan.';
    }

    const allowedPaths = new Set(
      plan.intendedFiles
        .filter((file) => file.changeType !== 'inspect')
        .map((file) => file.path.replace(/\\/g, '/'))
    );

    if (allowedPaths.size === 0) {
      return 'Patch tool calls require at least one non-inspect intended file in the plan.';
    }

    for (const mutatedPath of mutatedPaths.map((candidate) => candidate.replace(/\\/g, '/'))) {
      if (!allowedPaths.has(mutatedPath)) {
        return `Patch touches ${mutatedPath}, which is not declared as a mutable intended file.`;
      }
    }

    return null;
  }

  private validateCommandCallAgainstPlan(
    plan: TaskPlan | undefined,
    command: string,
    args: string[]
  ): string | null {
    if (!plan) {
      return 'Command tool calls require a validated plan.';
    }

    const fullCommand = [command, ...args].join(' ');
    return plan.commands.some((candidate) => candidate.command === fullCommand)
      ? null
      : `Command ${fullCommand} is not declared in the validated plan commands.`;
  }

  private validateReadCallAgainstPlan(plan: TaskPlan | undefined, targetPath: string): string | null {
    if (!plan) {
      return 'File read tool calls require a validated plan.';
    }

    return plan.intendedFiles.some((candidate) => candidate.path === targetPath)
      ? null
      : `File read target ${targetPath} is not declared in the validated plan.`;
  }

  private getResumableApprovedToolCalls(task: Task): ToolCall[] | null {
    if (!task.plan || !task.toolCalls || task.toolCalls.length === 0) {
      return null;
    }

    if (task.approval?.status !== 'approved' || !task.approval.approvalId) {
      return null;
    }

    let appliedApproval = false;
    const resumedToolCalls = task.toolCalls.map((toolCall) => {
      if (!appliedApproval && toolCall.name === 'patch.apply') {
        appliedApproval = true;
        return {
          ...toolCall,
          arguments: {
            ...toolCall.arguments,
            approvalId: task.approval?.approvalId,
          },
        };
      }

      return toolCall;
    });

    return appliedApproval ? resumedToolCalls : null;
  }

  private buildApprovalState(
    correlationId: string,
    result: EngineeringToolResult
  ): TaskApprovalState {
    let touchedPaths: string[] | undefined;
    let changedLines: number | undefined;

    if (result.output) {
      try {
        const parsed = JSON.parse(result.output) as {
          touchedPaths?: unknown;
          changedLines?: unknown;
        };
        touchedPaths = Array.isArray(parsed.touchedPaths)
          ? parsed.touchedPaths.filter((candidate): candidate is string => typeof candidate === 'string')
          : undefined;
        changedLines = typeof parsed.changedLines === 'number' ? parsed.changedLines : undefined;
      } catch {
        touchedPaths = undefined;
        changedLines = undefined;
      }
    }

    return {
      requestId: correlationId,
      status: 'requested',
      requestedAt: new Date(),
      requestedReason: result.summary,
      touchedPaths,
      changedLines,
    };
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

  private async handleAwaitingApprovalTask(
    task: Task,
    reason: string,
    taskMarkedInProgress: boolean
  ): Promise<void> {
    this.state.status = 'idle';
    this.state.currentTask = undefined;
    this.state.lastActivity = new Date();

    await this.memory.addSessionSummary(`Awaiting approval: ${task.description}`);
    await this.memory.addToTaskHistory(task, `Awaiting approval: ${reason}`);
    await this.memory.updateStatus('Awaiting Approval', task.description);

    if (taskMarkedInProgress) {
      await this.tasks.markTaskAwaitingApproval(task);
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
