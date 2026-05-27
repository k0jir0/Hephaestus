/**
 * Hephaestus Safety System
 * Guardrails and circuit breakers for safe autonomous operation
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { config } from './config.js';
import { createComponentLogger } from './logger.js';
import type { SafetyConfig } from './types.js';
import type { AgentState } from './types.js';

const execFileAsync = promisify(execFile);
const logger = createComponentLogger('Safety');

interface ExecFileResult {
  stdout: string;
  stderr: string;
}

export interface SafetySystemDependencies {
  safetyConfig?: SafetyConfig;
  targetProject?: string;
  gitRunner?: (args: string[], options: { cwd: string }) => Promise<ExecFileResult>;
}

export class SafetySystem {
  private state: AgentState;
  private lastAutoCommit: Date = new Date();
  private dailyStartTime: Date = new Date();
  private sessionCost: number = 0;
  private readonly safetyConfig: SafetyConfig;
  private readonly targetProject: string;
  private readonly gitRunner: (args: string[], options: { cwd: string }) => Promise<ExecFileResult>;

  constructor(dependencies: SafetySystemDependencies = {}) {
    this.safetyConfig = dependencies.safetyConfig ?? config.safety;
    this.targetProject = dependencies.targetProject ?? config.targetProject;
    this.gitRunner = dependencies.gitRunner ?? ((args, options) =>
      execFileAsync('git', args, options)
    );
    this.state = {
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
    logger.info('SafetySystem initialized');
  }

  /**
   * Check if agent should continue running
   */
  async shouldContinue(): Promise<{ allowed: boolean; reason?: string }> {
    // Check daily budget
    if (this.sessionCost >= this.safetyConfig.dailyTokenBudget) {
      logger.warn('Daily token budget exceeded', {
        spent: this.sessionCost,
        budget: this.safetyConfig.dailyTokenBudget,
      });
      return {
        allowed: false,
        reason: `Daily budget of $${this.safetyConfig.dailyTokenBudget} exceeded`,
      };
    }

    // Check iteration limit
    if (this.state.iterationCount >= this.safetyConfig.maxIterations) {
      logger.warn('Max iterations reached', {
        iterations: this.state.iterationCount,
        limit: this.safetyConfig.maxIterations,
      });
      return {
        allowed: false,
        reason: `Max iterations (${this.safetyConfig.maxIterations}) reached`,
      };
    }

    // Check error threshold
    if (this.state.consecutiveErrors >= this.safetyConfig.errorThreshold) {
      logger.warn('Error threshold exceeded', {
        errors: this.state.consecutiveErrors,
        threshold: this.safetyConfig.errorThreshold,
      });
      return {
        allowed: false,
        reason: `Error threshold (${this.safetyConfig.errorThreshold}) exceeded`,
      };
    }

    return { allowed: true };
  }

  /**
   * Record a successful operation
   */
  recordSuccess(): void {
    this.state.iterationCount++;
    this.state.consecutiveErrors = 0;
    this.state.lastActivity = new Date();
    logger.debug('Recorded success', {
      iterations: this.state.iterationCount,
    });
  }

  /**
   * Record a failed operation
   */
  recordError(error: string): void {
    this.state.iterationCount++;
    this.state.consecutiveErrors++;
    this.state.lastActivity = new Date();
    logger.warn('Recorded error', {
      error,
      consecutiveErrors: this.state.consecutiveErrors,
    });
  }

  /**
   * Record task completion
   */
  recordTaskCompletion(): void {
    this.state.totalTasksCompleted++;
    this.state.lastActivity = new Date();
  }

  /**
   * Record token usage
   */
  recordTokenUsage(promptTokens: number, completionTokens: number, cost: number): void {
    this.state.tokenUsage.promptTokens += promptTokens;
    this.state.tokenUsage.completionTokens += completionTokens;
    this.state.tokenUsage.totalCost += cost;
    this.sessionCost += cost;
    this.state.lastActivity = new Date();
  }

  /**
   * Check if auto-commit should run
   */
  shouldAutoCommit(): boolean {
    if (this.safetyConfig.autoCommitInterval <= 0) {
      return false;
    }

    const now = new Date();
    const elapsed = (now.getTime() - this.lastAutoCommit.getTime()) / 1000 / 60; // minutes

    return elapsed >= this.safetyConfig.autoCommitInterval;
  }

  /**
   * Perform auto-commit
   */
  async performAutoCommit(message?: string): Promise<boolean> {
    if (!this.shouldAutoCommit()) {
      return false;
    }

    try {
      const timestamp = new Date().toISOString();
      const commitMessage = message || `Auto-snapshot: ${timestamp}`;

      logger.info('Performing auto-commit', { message: commitMessage });

      // Check if we're in a git repository
      try {
        await this.gitRunner(['rev-parse', '--is-inside-work-tree'], {
          cwd: this.targetProject,
        });
      } catch {
        logger.debug('Not in a git repository, skipping auto-commit');
        return false;
      }

      // Stage all changes
      await this.gitRunner(['add', '-A'], { cwd: this.targetProject });

      // Check if there are changes to commit
      const { stdout } = await this.gitRunner(['status', '--porcelain'], {
        cwd: this.targetProject,
      });

      if (!stdout.trim()) {
        logger.debug('No changes to commit');
        return false;
      }

      // Commit
      await this.gitRunner(['commit', '-m', commitMessage], {
        cwd: this.targetProject,
      });

      this.lastAutoCommit = new Date();
      logger.info('Auto-commit completed');
      return true;
    } catch (error) {
      logger.error('Auto-commit failed', { error: String(error) });
      return false;
    }
  }

  /**
   * Check if budget is nearly exhausted
   */
  isBudgetNearlyExhausted(): boolean {
    const threshold = this.safetyConfig.dailyTokenBudget * 0.9; // 90%
    return this.sessionCost >= threshold;
  }

  /**
   * Get remaining budget
   */
  getRemainingBudget(): number {
    return Math.max(0, this.safetyConfig.dailyTokenBudget - this.sessionCost);
  }

  /**
   * Get current state
   */
  getState(): AgentState {
    return { ...this.state };
  }

  /**
   * Get status summary
   */
  getStatusSummary(): string {
    return `
=== Hephaestus Safety Status ===
Session Started: ${this.state.sessionStart.toISOString()}
Budget Window Started: ${this.dailyStartTime.toISOString()}
Total Tasks Completed: ${this.state.totalTasksCompleted}
Iteration Count: ${this.state.iterationCount}/${this.safetyConfig.maxIterations}
Consecutive Errors: ${this.state.consecutiveErrors}/${this.safetyConfig.errorThreshold}
Session Cost: $${this.sessionCost.toFixed(4)}/$${this.safetyConfig.dailyTokenBudget}
Remaining Budget: $${this.getRemainingBudget().toFixed(4)}
Last Activity: ${this.state.lastActivity.toISOString()}
`.trim();
  }

  /**
   * Reset daily counters (call at start of new day)
   */
  resetDailyCounters(): void {
    this.sessionCost = 0;
    this.dailyStartTime = new Date();
    this.state.tokenUsage = {
      promptTokens: 0,
      completionTokens: 0,
      totalCost: 0,
    };
    logger.info('Daily counters reset');
  }

  /**
   * Emergency shutdown - kill all processes and exit
   */
  async emergencyShutdown(reason: string): Promise<void> {
    logger.error('EMERGENCY SHUTDOWN', { reason });

    try {
      // Try graceful shutdown first
      this.state.status = 'shutdown';

      // Force exit after short delay
      setTimeout(() => {
        logger.error('Forcing process exit');
        process.exit(1);
      }, 1000);
    } catch {
      process.exit(1);
    }
  }
}
