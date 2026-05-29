import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assessSourceGrounding,
  extractSourceGroundingKeys,
  sourceGroundingIssueMessage,
} from '../src/domain/policy/source-grounding-policy.js';

describe('source grounding policy', () => {
  it('requires source grounding for blueprint or D2+ wording', () => {
    const assessment = assessSourceGrounding(
      'Implement D2 replay state in src/task-store.ts with deterministic verification.'
    );

    assert.equal(assessment.requiresGrounding, true);
    assert.equal(assessment.grounded, false);
  });

  it('recognizes source grounding by note key or source path', () => {
    const byKey = assessSourceGrounding(
      'Implement D2 replay state in src/task-store.ts using ChandyLamport1985.'
    );
    const byAdditionalD2Key = assessSourceGrounding(
      'Implement D2 projection consistency checks in src/task-store.ts using Helland2015.'
    );
    const byPath = assessSourceGrounding(
      'Update blueprint D3 policy in docs/blueprint-v2.md based on sources/notes/Yao2023ReAct.md.'
    );

    assert.equal(byKey.requiresGrounding, true);
    assert.equal(byKey.grounded, true);
    assert.equal(byAdditionalD2Key.requiresGrounding, true);
    assert.equal(byAdditionalD2Key.grounded, true);
    assert.equal(byPath.requiresGrounding, true);
    assert.equal(byPath.grounded, true);
  });

  it('does not require source grounding for non-blueprint tickets', () => {
    const assessment = assessSourceGrounding(
      'Fix failing test in src/runtime.ts and verify with npm run test.'
    );

    assert.equal(assessment.requiresGrounding, false);
    assert.equal(assessment.grounded, false);
  });

  it('returns a stable issue message for policy callers', () => {
    assert.match(sourceGroundingIssueMessage(), /Blueprint\/D2\+ tickets should include source grounding/);
  });

  it('extracts source grounding keys from direct keys and note paths', () => {
    const extracted = extractSourceGroundingKeys(
      'Implement blueprint D2 event checks with Yao2023ReAct and sources/notes/ChandyLamport1985.md.'
    );

    assert.deepEqual(extracted.sort(), ['ChandyLamport1985', 'Yao2023ReAct']);
  });
});
