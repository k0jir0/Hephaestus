import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  formatCommandInvocation,
  parseCommandPlan,
} from '../src/domain/plans/command-plan.js';

describe('command plan parsing', () => {
  it('parses bare and quoted command arguments', () => {
    assert.deepEqual(parseCommandPlan('npm test -- test/runtime.test.ts'), {
      command: 'npm',
      args: ['test', '--', 'test/runtime.test.ts'],
    });
    assert.deepEqual(parseCommandPlan('npm test -- "test/runtime smoke.test.ts"'), {
      command: 'npm',
      args: ['test', '--', 'test/runtime smoke.test.ts'],
    });
    assert.deepEqual(parseCommandPlan("'node_modules/.bin/tsc' --noEmit"), {
      command: 'node_modules/.bin/tsc',
      args: ['--noEmit'],
    });
  });

  it('rejects empty command plans and formats invocations', () => {
    assert.equal(parseCommandPlan(''), null);
    assert.equal(parseCommandPlan('   '), null);
    assert.equal(formatCommandInvocation('npm', ['test', '--', 'test/runtime.test.ts']), 'npm test -- test/runtime.test.ts');
  });
});
