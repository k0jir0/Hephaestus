import { appendFile, mkdir } from 'fs/promises';
import { execFile } from 'child_process';
import path from 'path';
import { promisify } from 'util';
import type { Config } from './config.js';
import { createComponentLogger } from './logger.js';
import { resolveModelProfile } from './model-profiles.js';
import type { AIBackend, AIResponse } from './types.js';

const execFileAsync = promisify(execFile);
const logger = createComponentLogger('ExecutorBackend');

interface ExecFileOptions {
  cwd?: string;
  timeout?: number;
  maxBuffer?: number;
}

interface ExecFileResult {
  stdout: string;
  stderr: string;
}

export interface BackendExecFileRunner {
  (file: string, args: string[], options?: ExecFileOptions): Promise<ExecFileResult>;
}

export interface BackendFetchLike {
  (input: string | URL, init?: RequestInit): Promise<Response>;
}

export interface AIBackendClient {
  readonly backend: AIBackend;
  requestStructuredPlan(prompt: string, systemPrompt: string): Promise<AIResponse>;
  checkHealth(): Promise<{ available: boolean; message: string }>;
}

export interface AIBackendClientDependencies {
  config: Config;
  execFileRunner?: BackendExecFileRunner;
  fetchImpl?: BackendFetchLike;
}

interface OllamaGenerateChunk {
  response?: string;
  done?: boolean;
  error?: string;
  prompt_eval_count?: number;
  eval_count?: number;
}

interface OllamaChatChunk {
  message?: {
    content?: string;
    thinking?: string;
  };
  done?: boolean;
  error?: string;
  prompt_eval_count?: number;
  eval_count?: number;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_duration?: number;
  eval_duration?: number;
}

interface OllamaCollectionResult {
  content: string;
  promptTokens: number;
  completionTokens: number;
}

function splitJsonLines(buffer: string): { lines: string[]; remainder: string } {
  const parts = buffer.split(/\r?\n/);
  const remainder = parts.pop() ?? '';
  return {
    lines: parts.filter((line) => line.trim().length > 0),
    remainder,
  };
}

export function createBackendClient(
  dependencies: AIBackendClientDependencies
): AIBackendClient {
  switch (dependencies.config.aiBackend) {
    case 'copilot':
      return new CopilotBackendClient(dependencies);
    case 'openai':
      return new OpenAIBackendClient(dependencies);
    case 'claude':
      return new ClaudeBackendClient(dependencies);
    case 'ollama':
      return new OllamaBackendClient(dependencies);
  }
}

abstract class BaseBackendClient implements AIBackendClient {
  protected readonly config: Config;
  protected readonly execFileRunner: BackendExecFileRunner;
  protected readonly fetchImpl: BackendFetchLike;
  abstract readonly backend: AIBackend;

  constructor(dependencies: AIBackendClientDependencies) {
    this.config = dependencies.config;
    this.execFileRunner = dependencies.execFileRunner ?? (async (file, args, options) => {
      const result = await execFileAsync(file, args, options);
      return {
        stdout: String(result.stdout),
        stderr: String(result.stderr),
      };
    });
    this.fetchImpl = dependencies.fetchImpl ?? fetch;
  }

  abstract requestStructuredPlan(prompt: string, systemPrompt: string): Promise<AIResponse>;
  abstract checkHealth(): Promise<{ available: boolean; message: string }>;
}

class CopilotBackendClient extends BaseBackendClient {
  readonly backend = 'copilot' as const;

  async requestStructuredPlan(prompt: string): Promise<AIResponse> {
    try {
      try {
        await this.execFileRunner('gh', ['copilot', '--version']);
      } catch {
        return {
          success: false,
          content:
            'GitHub Copilot CLI (gh copilot) is not installed or not authenticated. Run: gh copilot setup',
        };
      }

      const { stdout, stderr } = await this.execFileRunner(
        'gh',
        ['copilot', 'suggest', '-t', 'implement', prompt],
        {
          cwd: this.config.targetProject,
          timeout: 300000,
          maxBuffer: 10 * 1024 * 1024,
        }
      );

      if (stderr && !stdout) {
        logger.warn('Copilot stderr', { stderr });
      }

      return {
        success: true,
        content: stdout || stderr,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Copilot execution failed', { error: errorMessage });
      return {
        success: false,
        content: `Copilot execution failed: ${errorMessage}`,
      };
    }
  }

  async checkHealth(): Promise<{ available: boolean; message: string }> {
    try {
      await this.execFileRunner('gh', ['copilot', '--version']);
      return { available: true, message: 'GitHub Copilot CLI is available' };
    } catch {
      return { available: false, message: 'GitHub Copilot CLI is not installed or not authenticated' };
    }
  }
}

class OpenAIBackendClient extends BaseBackendClient {
  readonly backend = 'openai' as const;

  async requestStructuredPlan(prompt: string, systemPrompt: string): Promise<AIResponse> {
    try {
      if (!this.config.openaiApiKey) {
        return {
          success: false,
          content: 'OpenAI API key not configured. Set OPENAI_API_KEY in .env',
        };
      }

      const OpenAI = (await import('openai')).default;
      const client = new OpenAI({ apiKey: this.config.openaiApiKey });
      const model = this.config.aiModel || 'gpt-4o-mini';

      const response = await client.chat.completions.create({
        model,
        messages: [
          {
            role: 'system',
            content: systemPrompt,
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        max_tokens: 4000,
        temperature: 0.2,
      });

      const content = response.choices[0]?.message?.content || '';
      const usage = response.usage;

      return {
        success: true,
        content,
        cost: calculateOpenAICost(
          usage?.prompt_tokens || 0,
          usage?.completion_tokens || 0,
          model
        ),
        tokens: {
          prompt: usage?.prompt_tokens || 0,
          completion: usage?.completion_tokens || 0,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('OpenAI execution failed', { error: errorMessage });
      return {
        success: false,
        content: `OpenAI execution failed: ${errorMessage}`,
      };
    }
  }

  async checkHealth(): Promise<{ available: boolean; message: string }> {
    if (!this.config.openaiApiKey) {
      return { available: false, message: 'OPENAI_API_KEY not configured' };
    }

    return { available: true, message: 'OpenAI API key configured' };
  }
}

class ClaudeBackendClient extends BaseBackendClient {
  readonly backend = 'claude' as const;

  async requestStructuredPlan(prompt: string, systemPrompt: string): Promise<AIResponse> {
    try {
      if (!this.config.anthropicApiKey) {
        return {
          success: false,
          content: 'Anthropic API key not configured. Set ANTHROPIC_API_KEY in .env',
        };
      }

      const Anthropic = (await import('@anthropic-ai/sdk')).default;
      const client = new Anthropic({ apiKey: this.config.anthropicApiKey });
      const model = this.config.aiModel || 'claude-3-5-sonnet-20241022';

      const response = await client.messages.create({
        model,
        max_tokens: 4096,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      });

      const content = response.content[0].type === 'text' ? response.content[0].text : '';

      return {
        success: true,
        content,
        cost: calculateClaudeCost(response.usage.input_tokens, response.usage.output_tokens, model),
        tokens: {
          prompt: response.usage.input_tokens,
          completion: response.usage.output_tokens,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Claude execution failed', { error: errorMessage });
      return {
        success: false,
        content: `Claude execution failed: ${errorMessage}`,
      };
    }
  }

  async checkHealth(): Promise<{ available: boolean; message: string }> {
    if (!this.config.anthropicApiKey) {
      return { available: false, message: 'ANTHROPIC_API_KEY not configured' };
    }

    return { available: true, message: 'Anthropic API key configured' };
  }
}

class OllamaBackendClient extends BaseBackendClient {
  readonly backend = 'ollama' as const;

  async requestStructuredPlan(prompt: string, systemPrompt: string): Promise<AIResponse> {
    try {
      const model = this.config.aiModel || 'llama3';
      try {
        return await this.requestViaChat(model, prompt, systemPrompt);
      } catch (error) {
        logger.warn('Ollama chat request failed; falling back to generate API', {
          error: error instanceof Error ? error.message : String(error),
        });
      }

      return await this.requestViaGenerate(model, prompt, systemPrompt);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Ollama execution failed', { error: errorMessage });
      return {
        success: false,
        content: `Ollama execution failed: ${errorMessage}`,
      };
    }
  }

  private async requestViaChat(model: string, prompt: string, systemPrompt: string): Promise<AIResponse> {
    const resolvedProfile = resolveModelProfile(model, 'ollama');
    const profile = resolvedProfile.profile;
    const body: Record<string, unknown> = {
      model,
      stream: true,
      messages: [
        {
          role: 'system',
          content: systemPrompt,
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      options: {
        temperature: profile.recommendedOptions.temperature,
        num_predict: profile.recommendedOptions.numPredict ?? 4096,
      },
    };

    if (profile.recommendedOptions.keepAlive) {
      body.keep_alive = profile.recommendedOptions.keepAlive;
    }

    if (profile.capabilities.structuredOutputs) {
      body.format = 'json';
    }

    if (profile.capabilities.thinkingControls && profile.recommendedOptions.reasoningEffort) {
      body.think = profile.recommendedOptions.reasoningEffort;
    }

    const response = await this.fetchImpl(`${this.config.ollamaBaseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Ollama chat API error: ${response.status} ${response.statusText}`);
    }

    const collected = await this.collectStreamedChatResponse(response, model);
    return {
      success: true,
      content: collected.content || 'No response from Ollama',
      tokens: {
        prompt: collected.promptTokens,
        completion: collected.completionTokens,
      },
    };
  }

  private async requestViaGenerate(model: string, prompt: string, systemPrompt: string): Promise<AIResponse> {
      const response = await this.fetchImpl(`${this.config.ollamaBaseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          prompt: `${systemPrompt}\n\n${prompt}`,
          stream: true,
        }),
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.statusText}`);
      }

      const collected = await this.collectStreamedGenerateResponse(response, model);
      return {
        success: true,
        content: collected.content || 'No response from Ollama',
        tokens: {
          prompt: collected.promptTokens,
          completion: collected.completionTokens,
        },
      };
  }

  private async collectStreamedChatResponse(response: Response, model: string): Promise<OllamaCollectionResult> {
    await this.appendStreamLog(`\n=== ${new Date().toISOString()} model=${model} endpoint=chat ===\n`);

    if (!response.body) {
      const data = (await response.json()) as OllamaChatChunk;
      const fallbackContent = data.message?.content || '';
      if (fallbackContent.length > 0) {
        await this.appendStreamLog(`${fallbackContent}\n\n`);
      }
      return {
        content: fallbackContent,
        promptTokens: data.prompt_eval_count ?? 0,
        completionTokens: data.eval_count ?? 0,
      };
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    let promptTokens = 0;
    let completionTokens = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const { lines, remainder } = splitJsonLines(buffer);
      buffer = remainder;
      for (const line of lines) {
        const chunk = JSON.parse(line) as OllamaChatChunk;
        if (chunk.error) {
          throw new Error(chunk.error);
        }

        if (typeof chunk.message?.thinking === 'string' && chunk.message.thinking.length > 0) {
          await this.appendStreamLog(`[thinking] ${chunk.message.thinking}`);
        }

        if (typeof chunk.message?.content === 'string' && chunk.message.content.length > 0) {
          content += chunk.message.content;
          await this.appendStreamLog(chunk.message.content);
        }

        if (typeof chunk.prompt_eval_count === 'number') {
          promptTokens = chunk.prompt_eval_count;
        }

        if (typeof chunk.eval_count === 'number') {
          completionTokens = chunk.eval_count;
        }
      }
    }

    buffer += decoder.decode();
    if (buffer.trim().length > 0) {
      const chunk = JSON.parse(buffer) as OllamaChatChunk;
      if (chunk.error) {
        throw new Error(chunk.error);
      }

      if (typeof chunk.message?.content === 'string' && chunk.message.content.length > 0) {
        content += chunk.message.content;
        await this.appendStreamLog(chunk.message.content);
      }

      if (typeof chunk.prompt_eval_count === 'number') {
        promptTokens = chunk.prompt_eval_count;
      }

      if (typeof chunk.eval_count === 'number') {
        completionTokens = chunk.eval_count;
      }
    }

    await this.appendStreamLog('\n\n');
    return {
      content,
      promptTokens,
      completionTokens,
    };
  }

  private async collectStreamedGenerateResponse(response: Response, model: string): Promise<OllamaCollectionResult> {
    await this.appendStreamLog(`\n=== ${new Date().toISOString()} model=${model} endpoint=generate ===\n`);

    if (!response.body) {
      const data = (await response.json()) as OllamaGenerateChunk;
      const fallbackContent = data.response || '';
      if (fallbackContent.length > 0) {
        await this.appendStreamLog(`${fallbackContent}\n\n`);
      }
      return {
        content: fallbackContent,
        promptTokens: data.prompt_eval_count ?? 0,
        completionTokens: data.eval_count ?? 0,
      };
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    let promptTokens = 0;
    let completionTokens = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const { lines, remainder } = splitJsonLines(buffer);
      buffer = remainder;
      for (const line of lines) {
        const chunk = JSON.parse(line) as OllamaGenerateChunk;
        if (chunk.error) {
          throw new Error(chunk.error);
        }

        if (typeof chunk.response === 'string' && chunk.response.length > 0) {
          content += chunk.response;
          await this.appendStreamLog(chunk.response);
        }

        if (typeof chunk.prompt_eval_count === 'number') {
          promptTokens = chunk.prompt_eval_count;
        }

        if (typeof chunk.eval_count === 'number') {
          completionTokens = chunk.eval_count;
        }
      }
    }

    buffer += decoder.decode();
    if (buffer.trim().length > 0) {
      const chunk = JSON.parse(buffer) as OllamaGenerateChunk;
      if (chunk.error) {
        throw new Error(chunk.error);
      }

      if (typeof chunk.response === 'string' && chunk.response.length > 0) {
        content += chunk.response;
        await this.appendStreamLog(chunk.response);
      }

      if (typeof chunk.prompt_eval_count === 'number') {
        promptTokens = chunk.prompt_eval_count;
      }

      if (typeof chunk.eval_count === 'number') {
        completionTokens = chunk.eval_count;
      }
    }

    await this.appendStreamLog('\n\n');
    return {
      content,
      promptTokens,
      completionTokens,
    };
  }

  private async appendStreamLog(content: string): Promise<void> {
    try {
      const logPath = path.join(this.config.baseDir, 'logs', 'ollama-stream.out');
      await mkdir(path.dirname(logPath), { recursive: true });
      await appendFile(logPath, content, 'utf8');
    } catch (error) {
      logger.warn('Could not append Ollama stream log', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async checkHealth(): Promise<{ available: boolean; message: string }> {
    try {
      const response = await this.fetchImpl(`${this.config.ollamaBaseUrl}/api/tags`);
      if (response.ok) {
        return { available: true, message: 'Ollama is running' };
      }

      return { available: false, message: 'Ollama is not responding' };
    } catch {
      return { available: false, message: 'Ollama is not running' };
    }
  }
}

function calculateOpenAICost(promptTokens: number, completionTokens: number, model: string): number {
  const pricing: Record<string, { input: number; output: number }> = {
    'gpt-4o': { input: 5.0, output: 15.0 },
    'gpt-4o-mini': { input: 0.15, output: 0.60 },
    'gpt-4-turbo': { input: 10.0, output: 30.0 },
    'gpt-3.5-turbo': { input: 0.5, output: 1.5 },
  };

  const rates = pricing[model] || pricing['gpt-4o-mini'];
  return (promptTokens / 1_000_000) * rates.input + (completionTokens / 1_000_000) * rates.output;
}

function calculateClaudeCost(inputTokens: number, outputTokens: number, model: string): number {
  const pricing: Record<string, { input: number; output: number }> = {
    'claude-3-5-sonnet-20241022': { input: 3.0, output: 15.0 },
    'claude-3-opus-20240229': { input: 15.0, output: 75.0 },
    'claude-3-haiku-20240307': { input: 0.25, output: 1.25 },
  };

  const rates = pricing[model] || pricing['claude-3-5-sonnet-20241022'];
  return (inputTokens / 1_000_000) * rates.input + (outputTokens / 1_000_000) * rates.output;
}
