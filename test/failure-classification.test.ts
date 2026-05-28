import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  classifyFailureReason,
  formatFailureClassificationArtifact,
} from '../src/failure-classification.js';

describe('failure classification', () => {
  it('classifies planner, policy, environment, and verification failures', () => {
    assert.equal(classifyFailureReason('Structured plan validation failed').family, 'planner');
    assert.equal(classifyFailureReason('Patch failed validation: protected path').family, 'repository-policy');
    assert.equal(classifyFailureReason('Backend timeout: the model did not respond').family, 'environment');
    assert.equal(classifyFailureReason('Command failed: npm test').family, 'verification');
  });

  it('formats next-step recommendations as durable artifacts', () => {
    const artifact = formatFailureClassificationArtifact(
      'blocked_demo',
      'Unsupported task envelope: deploy to production'
    );

    assert.match(artifact, /\[blocked_demo\] failure\.classification unsupported-scope/);
    assert.match(artifact, /retryable=false/);
    assert.match(artifact, /Rewrite the ticket/);
  });
});
