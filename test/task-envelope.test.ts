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
});
