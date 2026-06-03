/**
 * Hephaestus AI Executor
 * Orchestrates prompt policy, backend transport, and structured plan parsing.
 */

import { config as defaultConfig, type Config } from './config.js';
import {
  createBackendClient,
  type AIBackendClient,
  type AIBackendClientDependencies,
} from './executor-backends.js';
import {
  StructuredPlanParser,
  StructuredPlanPolicy,
  type StructuredPlanPromptPolicy,
  type StructuredPlanResponseParser,
} from './executor-planning.js';
import { createComponentLogger } from './logger.js';
import type { AIResponse, Task } from './types.js';

const logger = createComponentLogger('Executor');

export interface AIExecutorDependencies extends Omit<AIBackendClientDependencies, 'config'> {
  config?: Config;
  backendClient?: AIBackendClient;
  promptPolicy?: StructuredPlanPromptPolicy;
  responseParser?: StructuredPlanResponseParser;
}

export class AIExecutor {
  private readonly runtimeConfig: Config;
  private readonly backendClient: AIBackendClient;
  private readonly promptPolicy: StructuredPlanPromptPolicy;
  private readonly responseParser: StructuredPlanResponseParser;

  constructor(dependencies: AIExecutorDependencies = {}) {
    this.runtimeConfig = dependencies.config ?? defaultConfig;
    this.backendClient = dependencies.backendClient ?? createBackendClient({
      config: this.runtimeConfig,
      execFileRunner: dependencies.execFileRunner,
      fetchImpl: dependencies.fetchImpl,
    });
    this.promptPolicy =
      dependencies.promptPolicy ?? new StructuredPlanPolicy(this.runtimeConfig.targetProject);
    this.responseParser =
      dependencies.responseParser ?? new StructuredPlanParser(this.runtimeConfig.targetProject);

    logger.info(`AIExecutor initialized with backend: ${this.backendClient.backend}`);
  }

  async executeTask(task: Task, context?: string): Promise<AIResponse> {
    logger.info(`Executing task: ${task.description}`);

    const response = await this.backendClient.requestStructuredPlan(
      this.promptPolicy.buildPrompt(task, context),
      this.promptPolicy.getSystemPrompt()
    );

    return this.responseParser.parse(response);
  }

  async checkHealth(): Promise<{ available: boolean; message: string }> {
    return this.backendClient.checkHealth();
  }
}
