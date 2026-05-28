import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildStructuredPlanPrompt,
  formatTaskPlanSummary,
  parseStructuredExecutionResponse,
  parseTaskPlan,
} from '../src/plan-contract.js';

describe('parseTaskPlan', () => {
  it('parses a valid JSON plan payload', () => {
    const plan = parseTaskPlan(`{
      "summary": "Inspect the queue runtime and update the executor contract.",
      "intendedFiles": [
        { "path": "src/runtime.ts", "changeType": "update", "purpose": "centralize orchestration" }
      ],
      "commands": [
        { "command": "npm test", "purpose": "validate runtime behavior", "expectedOutcome": "All tests pass" }
      ],
      "verification": ["Run npm test"],
      "risks": ["Requires backend JSON compliance"]
    }`);

    assert.equal(plan.summary, 'Inspect the queue runtime and update the executor contract.');
    assert.equal(plan.intendedFiles[0]?.path, 'src/runtime.ts');
    assert.equal(plan.commands[0]?.command, 'npm test');
  });

  it('accepts fenced JSON and formats a summary', () => {
    const plan = parseTaskPlan([
      '```json',
      '{',
      '  "summary": "Add a typed planning contract.",',
      '  "intendedFiles": [],',
      '  "commands": [],',
      '  "verification": ["Review the generated plan object"],',
      '  "risks": []',
      '}',
      '```',
    ].join('\n'));

    assert.equal(
      formatTaskPlanSummary(plan),
      'Add a typed planning contract. Planned files: 0. Commands: 0. Verification steps: 1.'
    );
  });

  it('ignores blank verification and risk entries when valid steps remain', () => {
    const plan = parseTaskPlan(`{
      "summary": "Tolerate minor model formatting noise.",
      "intendedFiles": [],
      "commands": [],
      "verification": ["", "Run npm test", "   "],
      "risks": ["", "May still fail on malformed JSON"]
    }`);

    assert.deepEqual(plan.verification, ['Run npm test']);
    assert.deepEqual(plan.risks, ['May still fail on malformed JSON']);
  });

  it('accepts verification entries returned as structured step objects', () => {
    const plan = parseTaskPlan(`{
      "summary": "Accept structured verification output.",
      "intendedFiles": [],
      "commands": [],
      "verification": [{ "step": "Run npm test" }],
      "risks": []
    }`);

    assert.deepEqual(plan.verification, ['Run npm test']);
  });

  it('accepts alternate verification field names and nested structured step objects', () => {
    const plan = parseTaskPlan(`{
      "summary": "Accept nested verification output.",
      "intendedFiles": [],
      "commands": [],
      "checks": [{ "check": { "text": "Run npm run build" } }],
      "risks": []
    }`);

    assert.deepEqual(plan.verification, ['Run npm run build']);
  });

  it('accepts alternate field names for file purpose, command purpose, and expected outcome', () => {
    const plan = parseTaskPlan(`{
      "summary": "Accept nearby model field names.",
      "intendedFiles": [
        { "path": "src/runtime.ts", "changeType": "update", "description": "centralize task orchestration" }
      ],
      "commands": [
        { "command": "npm test", "reason": "validate runtime flow", "successCriteria": "All tests pass" }
      ],
      "verification": [{ "action": "Review the generated task plan" }],
      "risks": []
    }`);

    assert.equal(plan.intendedFiles[0]?.purpose, 'centralize task orchestration');
    assert.equal(plan.commands[0]?.purpose, 'validate runtime flow');
    assert.equal(plan.commands[0]?.expectedOutcome, 'All tests pass');
    assert.deepEqual(plan.verification, ['Review the generated task plan']);
  });

  it('normalizes common change type aliases', () => {
    const plan = parseTaskPlan(`{
      "summary": "Normalize model change types.",
      "intendedFiles": [
        { "path": "src/runtime.ts", "changeType": "modify", "goal": "tighten runtime orchestration" },
        { "path": "src/runtime.ts", "changeType": "read", "goal": "inspect the current behavior" }
      ],
      "commands": [],
      "verification": ["Review the normalized change types"],
      "risks": []
    }`);

    assert.equal(plan.intendedFiles[0]?.changeType, 'update');
    assert.equal(plan.intendedFiles[1]?.changeType, 'inspect');
  });

  it('falls back to deterministic file and command purposes when the model omits them', () => {
    const plan = parseTaskPlan(`{
      "summary": "Tolerate omitted descriptive fields.",
      "intendedFiles": [
        { "path": "src/runtime.ts", "changeType": "update" }
      ],
      "commands": [
        { "command": "npm run build" }
      ],
      "verification": ["Review the generated plan"],
      "risks": []
    }`);

    assert.equal(plan.intendedFiles[0]?.purpose, 'update src/runtime.ts');
    assert.equal(plan.commands[0]?.purpose, 'Run npm run build');
  });

  it('serializes structured verification objects when they contain no named text field', () => {
    const plan = parseTaskPlan(`{
      "summary": "Keep odd verification objects from blocking execution.",
      "intendedFiles": [],
      "commands": [],
      "verification": [{ "kind": "manual-review", "target": "TASKS.md" }],
      "risks": []
    }`);

    assert.equal(plan.verification[0], 'manual-review');
  });

  it('parses optional typed tool calls alongside the validated plan', () => {
    const patch = [
      'diff --git a/README.md b/README.md',
      '--- a/README.md',
      '+++ b/README.md',
      '@@ -1 +1 @@',
      '-old',
      '+new',
      '',
    ].join('\\n');

    const parsed = parseStructuredExecutionResponse(`{
      "summary": "Apply a bounded README patch.",
      "intendedFiles": [
        { "path": "README.md", "changeType": "update", "purpose": "document the workflow" }
      ],
      "commands": [],
      "toolCalls": [
        {
          "name": "patch.apply",
          "arguments": {
            "patch": ${JSON.stringify(patch)}
          }
        }
      ],
      "verification": ["Review the patch result"],
      "risks": []
    }`);

    assert.equal(parsed.plan.summary, 'Apply a bounded README patch.');
    assert.equal(parsed.toolCalls.length, 1);
    assert.equal(parsed.toolCalls[0]?.name, 'patch.apply');
    assert.equal(typeof parsed.toolCalls[0]?.arguments.patch, 'string');
  });

  it('normalizes tool names and arguments aliases', () => {
    const parsed = parseStructuredExecutionResponse(`{
      "summary": "Read a focused file slice.",
      "intendedFiles": [
        { "path": "src/runtime.ts", "changeType": "inspect", "purpose": "gather runtime context" }
      ],
      "commands": [],
      "tools": [
        {
          "name": "readFile",
          "args": {
            "path": "src/runtime.ts",
            "startLine": 1,
            "endLine": 20
          }
        }
      ],
      "verification": ["Review the selected runtime slice"],
      "risks": []
    }`);

    assert.equal(parsed.toolCalls[0]?.name, 'file.read');
    assert.equal(parsed.toolCalls[0]?.arguments.path, 'src/runtime.ts');
  });

  it('rejects delivery tool calls outside the local execution envelope', () => {
    assert.throws(
      () =>
        parseStructuredExecutionResponse(`{
          "summary": "Open a pull request.",
          "intendedFiles": [],
          "commands": [],
          "toolCalls": [
            { "name": "github.pr", "arguments": { "title": "Demo" } }
          ],
          "verification": ["Ask the operator to deliver the change"],
          "risks": []
        }`),
      /repo\.search, file\.read, patch\.apply, command\.run/
    );
  });

  it('rejects a payload without verification steps', () => {
    assert.throws(
      () =>
        parseTaskPlan(`{
          "summary": "Missing verification.",
          "intendedFiles": [],
          "commands": [],
          "verification": [],
          "risks": []
        }`),
      /verification/
    );
  });
});

describe('buildStructuredPlanPrompt', () => {
  it('includes the schema and project context', () => {
    const prompt = buildStructuredPlanPrompt(
      {
        id: 'task_demo',
        description: 'Refine the runtime',
        status: 'pending',
        createdAt: new Date(),
      },
      'README excerpt',
      '.'
    );

    assert.match(prompt, /"summary"/);
    assert.match(prompt, /"toolCalls"/);
    assert.match(prompt, /README excerpt/);
    assert.match(prompt, /Project path: \./);
    assert.match(prompt, /Supported task classes/);
    assert.match(prompt, /Valid toolCalls.name values are exactly/);
    assert.doesNotMatch(prompt, /Valid toolCalls\.name values are exactly: .*github\.pr/);
    assert.match(prompt, /Do not emit delivery or source-control actions/);
    assert.match(prompt, /Use command.run only for safe verification commands/);
  });
});
