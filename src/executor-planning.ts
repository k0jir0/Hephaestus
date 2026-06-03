import { createComponentLogger } from './logger.js';
import {
  buildStructuredPlanPrompt,
  getStructuredPlanSystemPrompt,
  parseStructuredExecutionResponse,
} from './plan-contract.js';
import type { AIResponse, Task } from './types.js';

const logger = createComponentLogger('ExecutorPlanning');

export interface StructuredPlanPromptPolicy {
  buildPrompt(task: Task, context?: string): string;
  getSystemPrompt(): string;
}

export interface StructuredPlanResponseParser {
  parse(response: AIResponse): AIResponse;
}

export class StructuredPlanPolicy implements StructuredPlanPromptPolicy {
  constructor(private readonly targetProject: string) {}

  buildPrompt(task: Task, context?: string): string {
    return buildStructuredPlanPrompt(task, context, this.targetProject);
  }

  getSystemPrompt(): string {
    return getStructuredPlanSystemPrompt();
  }
}

export class StructuredPlanParser implements StructuredPlanResponseParser {
  constructor(private readonly targetProject?: string) {}

  parse(response: AIResponse): AIResponse {
    if (!response.success) {
      return response;
    }

    try {
      const parsed = parseStructuredExecutionResponse(response.content, this.targetProject);

      return {
        ...response,
        content: parsed.plan.summary,
        rawContent: response.content,
        plan: parsed.plan,
        toolCalls: parsed.toolCalls,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Structured plan validation failed', { error: errorMessage });

      return {
        ...response,
        success: false,
        rawContent: response.content,
        content: `Structured plan validation failed: ${errorMessage}`,
      };
    }
  }
}