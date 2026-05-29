import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildCommandRepairArtifacts,
  decideCommandPlanBinding,
  decidePatchPlanBinding,
  decideReadPlanBinding,
} from '../src/domain/policy/plan-binding-policy.js';
import { buildCommandCatalogPolicySnapshot } from '../src/domain/policy/command-catalog-policy.js';
import type { EngineeringToolResult, TaskPlan, ToolPolicySnapshot } from '../src/types.js';

function makePlan(): TaskPlan {
  return {
    summary: 'Bind tool calls to the validated plan',
    intendedFiles: [
      {
        path: 'src/runtime.ts',
        changeType: 'update',
        purpose: 'Exercise patch binding',
      },
      {
        path: 'README.md',
        changeType: 'inspect',
        purpose: 'Exercise read binding',
      },
    ],
    commands: [
      {
        commandId: 'npm.test',
        command: 'npm test -- test/runtime.test.ts',
        purpose: 'Verify runtime behavior',
      },
    ],
    verification: ['Run targeted runtime tests'],
    risks: [],
  };
}

function makeToolResult(
  status: EngineeringToolResult['status'],
  reasonCode?: string
): EngineeringToolResult {
  const now = new Date();
  return {
    id: 'tool_result',
    tool: 'command.run',
    status,
    startedAt: now,
    endedAt: now,
    summary: status === 'failure' ? 'Command failed.' : 'Command denied.',
    reasonCode,
    mutatedPaths: [],
  };
}

function makePolicySnapshot(): ToolPolicySnapshot {
  return {
    version: 'hephaestus-tool-policy/v1',
    workspaceRoot: '.',
    dryRunByDefault: false,
    maxReadBytes: 1024,
    maxOutputBytes: 1024,
    maxSearchResults: 5,
    commandTimeoutMs: 1000,
    commandAllowlist: ['npm run lint', 'npm test'],
    commandCatalog: buildCommandCatalogPolicySnapshot(),
    protectedPathPrefixes: [],
    patchRiskThresholds: {
      maxSafeTouchedPaths: 1,
      maxSafeChangedLines: 20,
    },
    generatedAt: new Date(),
    signature: 'policy_demo',
  };
}

describe('plan binding policy', () => {
  it('allows patch mutations only for mutable intended files', () => {
    assert.deepEqual(decidePatchPlanBinding(makePlan(), ['SRC\\RUNTIME.ts']), { allowed: true });
    assert.deepEqual(decidePatchPlanBinding(undefined, ['src/runtime.ts']), {
      allowed: false,
      code: 'validated-plan-required',
      reason: 'Patch tool calls require a validated plan.',
    });
    assert.deepEqual(decidePatchPlanBinding(makePlan(), ['README.md']), {
      allowed: false,
      code: 'patch-path-not-declared',
      reason: 'Patch touches readme.md, which is not declared as a mutable intended file.',
    });
  });

  it('requires command tool calls to exactly match planned commands', () => {
    assert.deepEqual(
      decideCommandPlanBinding(makePlan(), 'npm', ['test', '--', 'test/runtime.test.ts']),
      { allowed: true }
    );
    assert.deepEqual(decideCommandPlanBinding(makePlan(), 'npm', ['run', 'lint']), {
      allowed: false,
      code: 'command-not-declared',
      reason: 'Command npm run lint is not declared in the validated plan commands.',
    });

    assert.deepEqual(
      decideCommandPlanBinding(makePlan(), 'npm', ['test'], 'npm.test'),
      { allowed: true }
    );

    assert.deepEqual(
      decideCommandPlanBinding(makePlan(), 'npm', ['test'], 'unknown.command.id'),
      {
        allowed: false,
        code: 'command-id-unknown',
        reason: 'Command ID unknown.command.id is not defined in the command catalog.',
      }
    );
  });

  it('allows file reads only for declared plan files', () => {
    assert.deepEqual(decideReadPlanBinding(makePlan(), 'readme.md'), { allowed: true });
    assert.deepEqual(decideReadPlanBinding(makePlan(), 'package.json'), {
      allowed: false,
      code: 'read-path-not-declared',
      reason: 'File read target package.json is not declared in the validated plan. Declared plan files: src/runtime.ts, README.md.',
    });
  });

  it('formats command repair artifacts from policy snapshots and failures', () => {
    assert.deepEqual(
      buildCommandRepairArtifacts({
        correlationId: 'admission_demo',
        command: 'npm run strange-test',
        result: makeToolResult('denied', 'command-not-allowlisted'),
        plan: makePlan(),
        policySnapshot: makePolicySnapshot(),
      }),
      [
        '[admission_demo] command.repair npm run strange-test: denied by allowlist. Allowed commands include: npm run lint, npm test. Command catalog IDs include: npm.test => npm test, npm.run.test => npm run test, npm.run.build => npm run build, npm.run.validate-config => npm run validate:config, npm.run.preflight => npm run preflight, npm.run.start-once => npm run start:once, npm.run.tickets => npm run tickets, npm.run.tickets.review-wave => npm run tickets -- review-wave. Planned commands: npm.test => npm test -- test/runtime.test.ts. Rewrite with an allowlisted commandId or escalate.',
      ]
    );
    assert.deepEqual(
      buildCommandRepairArtifacts({
        correlationId: 'admission_demo',
        command: 'npm test',
        result: makeToolResult('failure'),
        plan: makePlan(),
      }),
      [
        '[admission_demo] command.repair npm test: command failed. Inspect stderr/output artifacts, narrow command scope, and retry with one explicit expected outcome.',
      ]
    );
  });
});
