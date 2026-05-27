import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SafetySystem } from '../src/safety.js';

describe('SafetySystem', () => {
  it('runs git auto-commit commands with argument vectors instead of shell strings', async () => {
    const calls: Array<{ args: string[]; cwd: string }> = [];
    const safety = new SafetySystem({
      safetyConfig: {
        dailyTokenBudget: 10,
        maxIterations: 50,
        errorThreshold: 5,
        autoCommitInterval: 30,
      },
      targetProject: 'C:/demo/project',
      gitRunner: async (args, options) => {
        calls.push({ args, cwd: options.cwd });

        if (args[0] === 'status') {
          return { stdout: ' M src/demo.ts\n', stderr: '' };
        }

        return { stdout: '', stderr: '' };
      },
    });
    const mutableSafety = safety as unknown as { lastAutoCommit: Date };
    const commitMessage = 'Auto-snapshot: quote " and semicolon ; stay literal';

    mutableSafety.lastAutoCommit = new Date(Date.now() - 31 * 60 * 1000);

    const committed = await safety.performAutoCommit(commitMessage);

    assert.equal(committed, true);
    assert.deepEqual(calls, [
      {
        args: ['rev-parse', '--is-inside-work-tree'],
        cwd: 'C:/demo/project',
      },
      {
        args: ['add', '-A'],
        cwd: 'C:/demo/project',
      },
      {
        args: ['status', '--porcelain'],
        cwd: 'C:/demo/project',
      },
      {
        args: ['commit', '-m', commitMessage],
        cwd: 'C:/demo/project',
      },
    ]);
  });
});