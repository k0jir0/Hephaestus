import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildSourceGroundingDriftAudit,
  extractEventEvidenceKeys,
  renderReport,
  type SourceGroundingSnapshot,
} from '../src/source-grounding-report.js';
import type { TaskEvent, TaskTicket } from '../src/types.js';

function makeTicket(id: string, description: string): TaskTicket {
  const now = new Date('2026-05-29T00:00:00.000Z');
  return {
    id,
    description,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    attemptCount: 0,
    sourceOrder: 1,
  };
}

function makeEvent(input: {
  ticketId: string;
  type: TaskEvent['type'];
  createdAt?: string;
  evidence?: Record<string, unknown>;
}): TaskEvent {
  return {
    ticketId: input.ticketId,
    type: input.type,
    createdAt: new Date(input.createdAt ?? '2026-05-29T00:00:00.000Z'),
    evidence: input.evidence,
  };
}

describe('source grounding report helpers', () => {
  it('extracts keys from direct and amended event evidence payloads', () => {
    const direct = extractEventEvidenceKeys(
      makeEvent({
        ticketId: 'ticket_1',
        type: 'created',
        evidence: { sourceGroundingKeys: ['ChandyLamport1985', 'Yao2023ReAct'] },
      })
    );
    const amended = extractEventEvidenceKeys(
      makeEvent({
        ticketId: 'ticket_1',
        type: 'amended',
        evidence: { sourceGroundingKeysAfter: ['Yao2023ReAct'] },
      })
    );

    assert.deepEqual(direct, ['ChandyLamport1985', 'Yao2023ReAct']);
    assert.deepEqual(amended, ['Yao2023ReAct']);
  });

  it('detects missing and drifted event evidence for auditable tickets', () => {
    const tickets: TaskTicket[] = [
      makeTicket('ticket_ok', 'Implement D2 replay guard using ChandyLamport1985 and verify with npm run test; expected signal: tests exit 0.'),
      makeTicket('ticket_drift', 'Implement D3 policy checks using Yao2023ReAct and verify with npm run test; expected signal: tests exit 0.'),
      makeTicket('ticket_missing', 'Implement blueprint D4 controls using Schick2023Toolformer and verify with npm run test; expected signal: tests exit 0.'),
      makeTicket('ticket_non_blueprint', 'Fix src/runtime.ts parser and verify with npm run build; expected signal: build exits 0.'),
    ];

    const events: TaskEvent[] = [
      makeEvent({
        ticketId: 'ticket_ok',
        type: 'created',
        evidence: { sourceGroundingKeys: ['ChandyLamport1985'] },
      }),
      makeEvent({
        ticketId: 'ticket_drift',
        type: 'created',
        evidence: { sourceGroundingKeys: ['ChandyLamport1985'] },
      }),
    ];

    const audit = buildSourceGroundingDriftAudit(tickets, events);

    assert.equal(audit.auditableTickets, 3);
    assert.equal(audit.ticketsWithEventEvidence, 2);
    assert.equal(audit.eventEvidenceCoverage, 2 / 3);
    assert.deepEqual(audit.driftedTickets, ['ticket_drift']);
    assert.deepEqual(audit.missingEvidenceTickets, ['ticket_missing']);
  });

  it('renders event evidence drift section in the markdown report', () => {
    const snapshot: SourceGroundingSnapshot = {
      timestamp: '2026-05-29T00:00:00.000Z',
      totalTickets: 10,
      requiredTickets: 5,
      groundedTickets: 4,
      groundingCoverage: 0.8,
      missingGroundingTickets: ['ticket_a'],
      groundingKeyCounts: [{ key: 'Yao2023ReAct', count: 2 }],
      eventEvidence: {
        auditableTickets: 4,
        ticketsWithEventEvidence: 3,
        eventEvidenceCoverage: 0.75,
        driftedTickets: ['ticket_b'],
        missingEvidenceTickets: ['ticket_c'],
      },
    };

    const report = renderReport(snapshot);

    assert.match(report, /Event Evidence Drift Audit/);
    assert.match(report, /Event evidence coverage: 75.0%/);
    assert.match(report, /Drifted tickets \(1\): ticket_b/);
    assert.match(report, /Missing event evidence tickets \(1\): ticket_c/);
  });
});
