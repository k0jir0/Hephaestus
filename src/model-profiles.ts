import type { AIBackend } from './types.js';

export type ModelTaskClass =
  | 'baseline-control'
  | 'small-edits'
  | 'repository-coding'
  | 'agentic-reasoning'
  | 'frontier-local';

export interface ModelCapabilities {
  chat: boolean;
  structuredOutputs: boolean;
  toolCalling: boolean;
  thinkingControls: boolean;
  longContext: boolean;
}

export interface ModelProfile {
  id: string;
  displayName: string;
  backend: AIBackend;
  family: string;
  aliases: string[];
  parameterScale: string;
  recommendedTaskClass: ModelTaskClass;
  contextWindowTokens?: number;
  approximateSizeGb?: number;
  minimumMemoryGb?: number;
  capabilities: ModelCapabilities;
  recommendedOptions: {
    temperature: number;
    numPredict?: number;
    keepAlive?: string;
    reasoningEffort?: 'low' | 'medium' | 'high';
  };
  notes: string[];
}

export interface ResolvedModelProfile {
  profile: ModelProfile;
  known: boolean;
  matchedAlias?: string;
}

export interface InstalledOllamaModel {
  name: string;
  sizeBytes?: number;
  sizeGb?: number;
  modifiedAt?: string;
  digest?: string;
  family?: string;
  parameterSize?: string;
  quantizationLevel?: string;
  profile: ResolvedModelProfile;
}

export interface ModelRecommendation {
  model: string;
  reason: string;
  installed: boolean;
}

const unknownCapabilities: ModelCapabilities = {
  chat: false,
  structuredOutputs: false,
  toolCalling: false,
  thinkingControls: false,
  longContext: false,
};

export const unknownModelProfile: ModelProfile = {
  id: 'unknown',
  displayName: 'Unknown model',
  backend: 'ollama',
  family: 'unknown',
  aliases: [],
  parameterScale: 'unknown',
  recommendedTaskClass: 'small-edits',
  capabilities: unknownCapabilities,
  recommendedOptions: {
    temperature: 0,
    numPredict: 4096,
    keepAlive: '5m',
  },
  notes: ['No built-in profile exists. Run benchmarks before promoting this model.'],
};

export const knownModelProfiles: ModelProfile[] = [
  {
    id: 'codellama',
    displayName: 'CodeLlama',
    backend: 'ollama',
    family: 'codellama',
    aliases: [
      'codellama',
      'codellama:latest',
      'codellama:7b',
      'codellama:7b-instruct',
      'codellama:13b',
      'codellama:34b',
      'codellama:70b',
    ],
    parameterScale: '7B-70B',
    recommendedTaskClass: 'baseline-control',
    contextWindowTokens: 16_000,
    approximateSizeGb: 3.8,
    minimumMemoryGb: 8,
    capabilities: {
      chat: true,
      structuredOutputs: false,
      toolCalling: false,
      thinkingControls: false,
      longContext: false,
    },
    recommendedOptions: {
      temperature: 0,
      numPredict: 2048,
      keepAlive: '5m',
    },
    notes: [
      'Keep as a baseline control, not as the preferred autonomous coding model.',
      'Small context and older agentic behavior make it weak for repository-scale work.',
    ],
  },
  {
    id: 'gpt-oss-20b',
    displayName: 'gpt-oss 20B',
    backend: 'ollama',
    family: 'gpt-oss',
    aliases: ['gpt-oss', 'gpt-oss:latest', 'gpt-oss:20b'],
    parameterScale: '20B MoE',
    recommendedTaskClass: 'agentic-reasoning',
    contextWindowTokens: 128_000,
    approximateSizeGb: 14,
    minimumMemoryGb: 16,
    capabilities: {
      chat: true,
      structuredOutputs: true,
      toolCalling: true,
      thinkingControls: true,
      longContext: true,
    },
    recommendedOptions: {
      temperature: 0,
      numPredict: 4096,
      keepAlive: '10m',
      reasoningEffort: 'medium',
    },
    notes: [
      'Good lower-memory candidate for reasoning, structured outputs, and tool-aware workflows.',
      'Benchmark before using as the default coding agent.',
    ],
  },
  {
    id: 'gpt-oss-120b',
    displayName: 'gpt-oss 120B',
    backend: 'ollama',
    family: 'gpt-oss',
    aliases: ['gpt-oss:120b'],
    parameterScale: '120B MoE',
    recommendedTaskClass: 'frontier-local',
    contextWindowTokens: 128_000,
    approximateSizeGb: 65,
    minimumMemoryGb: 80,
    capabilities: {
      chat: true,
      structuredOutputs: true,
      toolCalling: true,
      thinkingControls: true,
      longContext: true,
    },
    recommendedOptions: {
      temperature: 0,
      numPredict: 8192,
      keepAlive: '10m',
      reasoningEffort: 'high',
    },
    notes: ['High-compute local reasoning candidate. Do not promote without benchmark evidence.'],
  },
  {
    id: 'qwen3-coder-30b',
    displayName: 'Qwen3-Coder 30B',
    backend: 'ollama',
    family: 'qwen3-coder',
    aliases: ['qwen3-coder', 'qwen3-coder:latest', 'qwen3-coder:30b'],
    parameterScale: '30B MoE',
    recommendedTaskClass: 'repository-coding',
    contextWindowTokens: 256_000,
    approximateSizeGb: 19,
    minimumMemoryGb: 24,
    capabilities: {
      chat: true,
      structuredOutputs: true,
      toolCalling: true,
      thinkingControls: false,
      longContext: true,
    },
    recommendedOptions: {
      temperature: 0,
      numPredict: 8192,
      keepAlive: '10m',
    },
    notes: [
      'Preferred first serious local coding-agent candidate.',
      'Long context makes it a better fit for repository-aware task execution.',
    ],
  },
  {
    id: 'qwen3-coder-480b',
    displayName: 'Qwen3-Coder 480B',
    backend: 'ollama',
    family: 'qwen3-coder',
    aliases: ['qwen3-coder:480b', 'qwen3-coder:480b-cloud'],
    parameterScale: '480B MoE',
    recommendedTaskClass: 'frontier-local',
    contextWindowTokens: 256_000,
    approximateSizeGb: 290,
    minimumMemoryGb: 250,
    capabilities: {
      chat: true,
      structuredOutputs: true,
      toolCalling: true,
      thinkingControls: false,
      longContext: true,
    },
    recommendedOptions: {
      temperature: 0,
      numPredict: 8192,
      keepAlive: '10m',
    },
    notes: ['Ambitious high-memory or cloud-backed target, not a baseline local default.'],
  },
];

export function normalizeModelName(value: string): string {
  return value.trim().toLowerCase();
}

export function resolveModelProfile(modelName: string, backend: AIBackend = 'ollama'): ResolvedModelProfile {
  const normalized = normalizeModelName(modelName);
  const profile = knownModelProfiles.find((candidate) =>
    candidate.backend === backend &&
    candidate.aliases.some((alias) => normalizeModelName(alias) === normalized)
  );

  if (profile) {
    return {
      profile,
      known: true,
      matchedAlias: modelName,
    };
  }

  const familyProfile = knownModelProfiles.find((candidate) =>
    candidate.backend === backend &&
    normalized.startsWith(`${candidate.family}:`)
  );

  if (familyProfile) {
    return {
      profile: familyProfile,
      known: true,
      matchedAlias: familyProfile.family,
    };
  }

  return {
    profile: {
      ...unknownModelProfile,
      id: normalized || 'unknown',
      displayName: modelName || 'Unspecified model',
      backend,
      aliases: modelName ? [modelName] : [],
    },
    known: false,
  };
}

export function summarizeModelProfile(modelName: string, backend: AIBackend = 'ollama'): string {
  const resolved = resolveModelProfile(modelName || 'unspecified', backend);
  const profile = resolved.profile;
  const context = profile.contextWindowTokens
    ? `${profile.contextWindowTokens.toLocaleString()} ctx`
    : 'unknown ctx';
  const known = resolved.known ? 'profiled' : 'unprofiled';
  return `${profile.displayName} (${known}, ${profile.recommendedTaskClass}, ${context})`;
}

export function recommendModel(installedModels: InstalledOllamaModel[]): ModelRecommendation[] {
  const installed = new Set(installedModels.map((model) => normalizeModelName(model.name)));
  const candidates = ['qwen3-coder:30b', 'gpt-oss:20b', 'codellama:latest'];

  return candidates.map((model) => {
    const isInstalled = installed.has(normalizeModelName(model));
    if (model === 'qwen3-coder:30b') {
      return {
        model,
        installed: isInstalled,
        reason: 'Preferred first coding-agent upgrade when hardware can run a 19 GB model.',
      };
    }

    if (model === 'gpt-oss:20b') {
      return {
        model,
        installed: isInstalled,
        reason: 'Lower-memory reasoning and structured-output candidate.',
      };
    }

    return {
      model,
      installed: isInstalled,
      reason: 'Baseline control only; useful for comparison but not the target default.',
    };
  });
}

export function bytesToGb(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) {
    return undefined;
  }

  return Math.round((value / 1024 / 1024 / 1024) * 10) / 10;
}
