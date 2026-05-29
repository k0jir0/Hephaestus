import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildApprovalRequestState,
  describePatchSubject,
  formatApprovalResumeArtifact,
  formatBackendEvidenceArtifact,
  formatDeferredMutationArtifact,
  formatDeniedToolArtifact,
  formatPatchDeltaArtifact,
  formatPolicySnapshotArtifact,
  formatToolExecutionArtifact,
  formatToolFailureReason,
} from '../src/domain/evidence/execution-artifacts.js';
import type { EngineeringToolResult, ToolPolicySnapshot } from '../src/types.js';

function makeResult(
  status: EngineeringToolResult['status'],
  overrides: Partial<EngineeringToolResult> = {}
): EngineeringToolResult {
  const now = new Date();
  return {
    id: 'tool_result',
    tool: 'patch.apply',
    status,
    startedAt: now,
    endedAt: now,
    summary: `${status} summary`,
    mutatedPaths: [],
    ...overrides,
  };
}

function makePolicySnapshot(): ToolPolicySnapshot {
  return {
    version: 'hephaestus-tool-policy/v1',
    workspaceRoot: '.',
    dryRunByDefault: false,
    maxReadBytes: 1024,
    maxOutputBytes: 2048,
    maxSearchResults: 5,
    commandTimeoutMs: 1000,
    commandAllowlist: ['npm test'],
    protectedPathPrefixes: ['.git'],
    patchRiskThresholds: {
      maxSafeTouchedPaths: 1,
      maxSafeChangedLines: 20,
    },
    generatedAt: new Date('2026-05-29T12:00:00.000Z'),
    signature: 'policy1234abcd5678',
  };
}

describe('execution evidence artifacts', () => {
  it('formats tool, backend, policy, and denial artifacts', () => {
    assert.equal(
      formatToolExecutionArtifact({
        correlationId: 'admission_demo',
        tool: 'patch.apply',
        subject: 'README.md [dry-run]',
        result: makeResult('dry_run', {
          reasonCode: 'dry-run-only',
          summary: 'Patch dry-run succeeded.',
        }),
      }),
      '[admission_demo] patch.apply README.md [dry-run] -> dry_run [dry-run-only]: Patch dry-run succeeded.'
    );
    assert.equal(
      formatBackendEvidenceArtifact({
        correlationId: 'admission_demo',
        backend: 'ollama',
        model: 'qwen3-coder',
      }),
      '[admission_demo] backend.ollama model=qwen3-coder'
    );
    assert.match(
      formatPolicySnapshotArtifact('admission_demo', makePolicySnapshot()),
      /^\[admission_demo\] policy\.snapshot \[policy1234abcd5678\]/
    );
    assert.equal(
      formatDeniedToolArtifact('admission_demo', 'file.read', 'tool call is missing a path string.'),
      '[admission_demo] denied file.read: tool call is missing a path string.'
    );
  });

  it('formats patch deltas, deferred mutations, approval resumes, and failure reasons', () => {
    const dryRunResult = makeResult('dry_run', {
      reasonCode: 'dry-run-only',
      mutatedPaths: ['README.md'],
    });
    const applyResult = makeResult('denied', {
      reasonCode: 'approval-required',
      mutatedPaths: ['README.md', 'src/runtime.ts'],
      error: 'approval needed',
    });

    assert.equal(describePatchSubject([]), 'patch');
    assert.equal(describePatchSubject(['README.md', 'src/runtime.ts']), 'README.md, src/runtime.ts');
    assert.equal(
      formatPatchDeltaArtifact({
        correlationId: 'admission_demo',
        subject: 'README.md',
        dryRunResult,
        applyResult,
      }),
      '[admission_demo] patch.delta README.md: dry-run=dry_run/dry-run-only; apply=denied/approval-required; mutatedPaths=README.md,src/runtime.ts'
    );
    assert.equal(
      formatDeferredMutationArtifact('admission_demo', 'update', 'src/runtime.ts'),
      '[admission_demo] deferred-mutation update src/runtime.ts: mutating file plans require governed tool calls.'
    );
    assert.equal(
      formatApprovalResumeArtifact('admission_demo', 'request_1', 'approval_1'),
      '[admission_demo] approval.resume request_1 -> approval_1'
    );
    assert.equal(formatToolFailureReason(applyResult), 'denied summary: approval needed');
  });

  it('builds approval request state from structured tool output', () => {
    const approval = buildApprovalRequestState(
      'admission_demo',
      makeResult('denied', {
        summary: 'Approval required.',
        output: JSON.stringify({
          touchedPaths: ['README.md', 123, 'src/runtime.ts'],
          changedLines: 42,
        }),
      })
    );

    assert.equal(approval.requestId, 'admission_demo');
    assert.equal(approval.status, 'requested');
    assert.equal(approval.requestedReason, 'Approval required.');
    assert.deepEqual(approval.touchedPaths, ['README.md', 'src/runtime.ts']);
    assert.equal(approval.changedLines, 42);
  });
});
