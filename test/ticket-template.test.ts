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
});
