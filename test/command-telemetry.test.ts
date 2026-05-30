import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createCommandAttemptTelemetry,
  formatCommandTelemetryArtifact,
  recordCommandTelemetry,
  summarizeCommandTelemetryFromAttempts,
} from '../src/domain/policy/command-telemetry.js';
import type { TaskAttempt } from '../src/types.js';

describe('command telemetry', () => {
  it('formats compact per-attempt command catalog telemetry artifacts', () => {
    const telemetry = createCommandAttemptTelemetry();

    recordCommandTelemetry(telemetry, { commandId: 'npm.test', status: 'success' });
    recordCommandTelemetry(telemetry, { status: 'denied', reasonCode: 'command-not-allowlisted' });

    assert.equal(
      formatCommandTelemetryArtifact('admission_demo', telemetry),
      '[admission_demo] command.telemetry {"commandCallCount":2,"commandIdCallCount":1,"rawCommandCallCount":1,"allowlistDenialCount":1,"commandIds":{"npm.test":1},"commandIdUsageRate":0.5,"allowlistDenialRate":0.5}'
    );
  });

  it('aggregates explicit and legacy command artifacts across attempts', () => {
    const now = new Date('2026-05-29T12:00:00.000Z');
    const attempts: TaskAttempt[] = [
      {
        id: 'attempt_explicit',
        ticketId: 'ticket_1',
        attemptNumber: 1,
        status: 'completed',
        startedAt: now,
        artifacts: [
          '[admission_1] command.telemetry {"commandCallCount":1,"commandIdCallCount":1,"rawCommandCallCount":0,"allowlistDenialCount":0,"commandIds":{"npm.test":1},"commandIdUsageRate":1,"allowlistDenialRate":0}',
        ],
      },
      {
        id: 'attempt_legacy',
        ticketId: 'ticket_2',
        attemptNumber: 1,
        status: 'failed',
        startedAt: now,
        error: 'Command is not allowlisted: npm run strange-test',
        artifacts: [
          '[admission_2] command.run npm.run.build -> npm run build -> success: ok',
          '[admission_2] command.run npm run strange-test -> denied [command-not-allowlisted]: denied',
        ],
      },
    ];

    const summary = summarizeCommandTelemetryFromAttempts(attempts);

    assert.equal(summary.commandCallCount, 3);
    assert.equal(summary.commandIdCallCount, 2);
    assert.equal(summary.rawCommandCallCount, 1);
    assert.equal(summary.allowlistDenialCount, 1);
    assert.equal(summary.allowlistDeniedAttemptCount, 1);
    assert.equal(summary.commandIdUsageRate, 0.667);
    assert.deepEqual(summary.topCommandIds, [
      { commandId: 'npm.run.build', count: 1 },
      { commandId: 'npm.test', count: 1 },
    ]);
  });
});
