import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assessTicketTemplate } from '../src/ticket-template.js';

describe('ticket template quality gate', () => {
  it('accepts bounded tickets with deterministic verification and expected signal', () => {
    const assessment = assessTicketTemplate(
      'Optimize src/runtime.ts context cache and verify with npm run build; expected signal: build exits 0 and no TypeScript errors.'
    );

    assert.equal(assessment.valid, true);
    assert.equal(assessment.issues.length, 0);
  });

  it('rejects broad multi-scope tickets without expected signal', () => {
    const assessment = assessTicketTemplate(
      'Review src/runtime.ts and src/task-store.ts and src/ui.ts and improve everything with verify command.'
    );

    assert.equal(assessment.valid, false);
    assert.ok(assessment.issues.some((issue) => issue.includes('expected signal')));
    assert.ok(assessment.issues.some((issue) => issue.includes('<=2 scoped files')));
  });

  it('rejects blueprint D2+ tickets missing source grounding', () => {
    const assessment = assessTicketTemplate(
      'Implement D2 replay evidence in src/task-store.ts and verify with npm run test; expected signal: replay tests exit 0.'
    );

    assert.equal(assessment.valid, false);
    assert.ok(assessment.issues.some((issue) => issue.includes('source grounding')));
  });

  it('accepts blueprint D2+ tickets with source grounding', () => {
    const assessment = assessTicketTemplate(
      'Implement D2 replay evidence in src/task-store.ts using ChandyLamport1985 and verify with npm run test; expected signal: replay tests exit 0.'
    );

    assert.equal(assessment.valid, true);
    assert.equal(assessment.issues.length, 0);
  });
});
