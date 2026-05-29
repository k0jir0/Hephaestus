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
  | 'stale'
  | 'cancelled'
  | 'superseded';

export type TaskAttemptStatus =
  | 'in_progress'
  | 'awaiting_approval'
  | 'completed'
  | 'blocked'
  | 'failed'
  | 'stale'
  | 'cancelled';

export type AgentStatus = 'idle' | 'working' | 'error' | 'shutdown' | 'blocked' | 'paused';

export type PlannedFileChangeType = 'create' | 'update' | 'delete' | 'inspect';
export type TaskExecutionPhase = 'inspect' | 'localize' | 'edit' | 'verify' | 'summarize' | 'escalate';

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
  toolCalls?: ToolCall[];
  approval?: TaskApprovalState;
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
    | 'stale-recovered'
    | 'cancelled'
    | 'superseded'
    | 'amended'
    | 'requeued'
    | 'attempt-started'
    | 'attempt-finished'
    | 'approval-requested'
    | 'approval-approved'
    | 'approval-rejected'
    | 'approval-resumed'
    | 'board-synced'
    | 'side-effect-enqueued'
    | 'side-effect-completed'
    | 'side-effect-failed';
  createdAt: Date;
  details?: string;
  correlationId?: string;
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
  toolCalls?: ToolCall[];
  approval?: TaskApprovalState;
  artifacts: string[];
}

export interface TaskApprovalState {
  requestId: string;
  status: 'requested' | 'approved' | 'rejected';
  requestedAt: Date;
  requestedReason?: string;
  touchedPaths?: string[];
  changedLines?: number;
  decisionAt?: Date;
  reviewer?: string;
  rationale?: string;
  approvalId?: string;
}

export type TaskSideEffectType =
  | 'memory.record-task-completion'
  | 'memory.add-task-history'
  | 'memory.add-session-summary'
  | 'memory.record-blocker';

export type TaskSideEffectStatus = 'pending' | 'completed' | 'failed';

export interface TaskSideEffect {
  id: string;
  ticketId: string;
  attemptId?: string;
  correlationId?: string;
  type: TaskSideEffectType;
  payload: Record<string, unknown>;
  status: TaskSideEffectStatus;
  idempotencyKey: string;
  createdAt: Date;
  processedAt?: Date;
  lastError?: string;
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

export interface TaskVerificationContract {
  commands: string[];
  expectedSignal: string;
}

export interface TaskActionContract {
  phase: TaskExecutionPhase;
  intent: string;
  actions: ToolCall[];
  verification: TaskVerificationContract;
  escalationReason?: string;
}

export interface TaskPlan {
  summary: string;
  intendedFiles: PlannedFileChange[];
  commands: PlannedCommand[];
  verification: string[];
  risks: string[];
  actionContract?: TaskActionContract;
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
  name: EngineeringToolName;
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
  reasonCode?: string;
  output?: string;
  error?: string;
  exitCode?: number;
  mutatedPaths: string[];
}

export interface ToolPolicySnapshot {
  version: string;
  workspaceRoot: string;
  dryRunByDefault: boolean;
  maxReadBytes: number;
  maxOutputBytes: number;
  maxSearchResults: number;
  commandTimeoutMs: number;
  commandAllowlist: string[];
  protectedPathPrefixes: string[];
  patchRiskThresholds: {
    maxSafeTouchedPaths: number;
    maxSafeChangedLines: number;
  };
  generatedAt: Date;
  signature: string;
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
