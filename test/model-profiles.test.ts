import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  recommendModel,
  resolveModelProfile,
  summarizeModelProfile,
  type InstalledOllamaModel,
} from '../src/model-profiles.js';

describe('model profiles', () => {
  it('resolves known local coding candidates and exposes task classes', () => {
    const qwen = resolveModelProfile('qwen3-coder:30b', 'ollama');
    assert.equal(qwen.known, true);
    assert.equal(qwen.profile.recommendedTaskClass, 'repository-coding');
    assert.equal(qwen.profile.capabilities.structuredOutputs, true);

    const gptOss = resolveModelProfile('gpt-oss', 'ollama');
    assert.equal(gptOss.known, true);
    assert.equal(gptOss.profile.capabilities.thinkingControls, true);

    const summary = summarizeModelProfile('codellama:latest', 'ollama');
    assert.match(summary, /baseline-control/);
  });

  it('marks unknown models as unprofiled instead of blocking execution', () => {
    const resolved = resolveModelProfile('experimental-local-model:latest', 'ollama');
    assert.equal(resolved.known, false);
    assert.equal(resolved.profile.displayName, 'experimental-local-model:latest');
    assert.equal(resolved.profile.recommendedTaskClass, 'small-edits');
  });

  it('recommends qwen3-coder first while preserving installation evidence', () => {
    const installed: InstalledOllamaModel[] = [
      {
        name: 'codellama:latest',
        profile: resolveModelProfile('codellama:latest', 'ollama'),
      },
    ];

    const recommendations = recommendModel(installed);
    assert.equal(recommendations[0]?.model, 'qwen3-coder:30b');
    assert.equal(recommendations[0]?.installed, false);
    assert.equal(recommendations[2]?.model, 'codellama:latest');
    assert.equal(recommendations[2]?.installed, true);
  });
});
