import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatRankedContextCandidates, rankContextCandidates } from '../src/context-ranking.js';

describe('rankContextCandidates', () => {
  it('prioritizes task-relevant files over generic repository context', () => {
    const ranked = rankContextCandidates(
      'Fix failing UI approval button test',
      [
        'src/runtime.ts',
        'src/ui.ts',
        'src/ui-server.ts',
        'test/ui-server.test.ts',
        'docs/architecture.md',
      ],
      3
    );

    assert.deepEqual(
      ranked.map((candidate) => candidate.path),
      ['test/ui-server.test.ts', 'src/ui-server.ts', 'src/ui.ts']
    );
    assert.ok(ranked[0]?.reasons.includes('test-hint'));
    assert.match(formatRankedContextCandidates(ranked), /test\/ui-server\.test\.ts score=/);
  });
});
