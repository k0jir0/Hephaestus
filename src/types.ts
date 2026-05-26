/**
 * Hephaestus Type Definitions
 */

export type AIBackend = 'copilot' | 'openai' | 'claude' | 'ollama';

export type TaskStatus =
  | 'pending'
  | 'in_progress'
  | 'planned'
  | 'awaiting_approval'
  | 'applying'
  | 'verifying'
  | 'completed'
  | 'merged'
  | 'blocked'
  | 'failed'
  | 'cancelled';

export type TaskAttemptStatus =
  | 'in_progress'
  | 'completed'
  | 'blocked'
  | 'failed'
  | 'cancelled';

export type AgentStatus = 'idle' | 'working' | 'error' | 'shutdown' | 'blocked';

export type PlannedFileChangeType = 'create' | 'update' | 'delete' | 'inspect';

export interface Task {
  id: string;
  description: string;
  status: TaskStatus;
  createdAt: Date;
  updatedAt?: Date;
  attemptCount?: number;
  sourceOrder?: number;
  startedAt?: Date;
  completedAt?: Date;
  blockedAt?: Date;
  cancelledAt?: Date;
  currentAttemptId?: string;
  result?: string;
  error?: string;
  plan?: TaskPlan;
}

export interface TaskTicket extends Task {
  updatedAt: Date;
  attemptCount: number;
  sourceOrder: number;
}

export interface TaskEvent {
  ticketId: string;
  type:
    | 'created'
    | 'claimed'
    | 'completed'
    | 'blocked'
    | 'cancelled'
    | 'requeued'
    | 'attempt-started'
    | 'attempt-finished'
    | 'board-synced';
  createdAt: Date;
  details?: string;
}

export interface TaskAttempt {
  id: string;
  ticketId: string;
  attemptNumber: number;
  status: TaskAttemptStatus;
  startedAt: Date;
  endedAt?: Date;
  result?: string;
  error?: string;
  plan?: TaskPlan;
  artifacts: string[];
}

export interface AgentState {
  status: AgentStatus;
  currentTask?: Task;
  iterationCount: number;
  totalTasksCompleted: number;
  consecutiveErrors: number;
  lastActivity: Date;
  sessionStart: Date;
  tokenUsage: {
    promptTokens: number;
    completionTokens: number;
    totalCost: number;
  };
}

export interface SafetyConfig {
  dailyTokenBudget: number;
  maxIterations: number;
  errorThreshold: number;
  autoCommitInterval: number;
}

export interface PlannedFileChange {
  path: string;
  changeType: PlannedFileChangeType;
  purpose: string;
}

export interface PlannedCommand {
  command: string;
  purpose: string;
  expectedOutcome?: string;
}

export interface TaskPlan {
  summary: string;
  intendedFiles: PlannedFileChange[];
  commands: PlannedCommand[];
  verification: string[];
  risks: string[];
}

export interface AIResponse {
  success: boolean;
  content: string;
  rawContent?: string;
  plan?: TaskPlan;
  toolCalls?: ToolCall[];
  cost?: number;
  tokens?: {
    prompt: number;
    completion: number;
  };
}

export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
  result?: string;
  error?: string;
}

export type EngineeringToolName =
  | 'repo.search'
  | 'file.read'
  | 'patch.apply'
  | 'command.run'
  | 'git.branch'
  | 'git.commit'
  | 'github.pr';

export type EngineeringToolStatus = 'success' | 'failure' | 'denied' | 'dry_run';

export interface EngineeringToolResult {
  id: string;
  tool: EngineeringToolName;
  status: EngineeringToolStatus;
  startedAt: Date;
  endedAt: Date;
  summary: string;
  output?: string;
  error?: string;
  exitCode?: number;
  mutatedPaths: string[];
}

export interface MemoryEntry {
  timestamp: Date;
  type: 'task' | 'pattern' | 'preference' | 'note';
  content: string;
  source: 'agent' | 'user';
}

export interface ProgressEntry {
  timestamp: Date;
  action: string;
  task?: string;
  result: 'success' | 'failure' | 'info';
  details?: string;
}
