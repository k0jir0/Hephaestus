import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classifyTaskEnvelope, formatTaskEnvelopeDecision } from '../src/task-envelope.js';

describe('task envelope classification', () => {
  it('accepts bounded engineering work classes', () => {
    assert.equal(classifyTaskEnvelope('Fix a failing test in src/runtime.ts').taskClass, 'test-repair');
    assert.equal(classifyTaskEnvelope('Update README about the control plane').taskClass, 'documentation-update');
    assert.equal(classifyTaskEnvelope('Repair CI workflow lint failure').taskClass, 'ci-repair');
  });

  it('defers broad delivery or production work', () => {
    const decision = classifyTaskEnvelope('Open a pull request and deploy this to production');

    assert.equal(decision.supported, false);
    assert.equal(decision.taskClass, 'unsupported');
    assert.match(formatTaskEnvelopeDecision(decision), /Unsupported task envelope/);
    assert.match(decision.recommendation, /Split the work/);
  });

  it('defers blueprint D2+ tickets without source grounding', () => {
    const decision = classifyTaskEnvelope(
      'Implement D2 replay evidence in src/task-store.ts and verify with npm run test; expected signal: tests exit 0.'
    );

    assert.equal(decision.supported, false);
    assert.equal(decision.taskClass, 'unsupported');
    assert.match(decision.reason, /source grounding/i);
  });

  it('accepts blueprint D2+ tickets with source grounding', () => {
    const decision = classifyTaskEnvelope(
      'Implement D2 replay evidence in src/task-store.ts using ChandyLamport1985 and verify with npm run test; expected signal: tests exit 0.'
    );

    assert.equal(decision.supported, true);
    assert.equal(decision.taskClass, 'focused-code-change');
  });
});
