import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isOperationalTicket, isSyntheticBenchmarkTicket } from '../src/operational-ticket-filter.js';

describe('operational ticket filter', () => {
  it('classifies H50 checkpoint tickets as synthetic benchmark work', () => {
    const ticket = {
      description:
        'Update docs/metrics/hephaestus-50-ticket-test.md with H50J3-050 checkpoint entry, verify with npm run build, expected signal: build exits 0.',
    };

    assert.equal(isSyntheticBenchmarkTicket(ticket), true);
    assert.equal(isOperationalTicket(ticket), false);
  });

  it('classifies qwen-wave metric docs tickets as synthetic benchmark work', () => {
    const ticket = {
      description:
        'Implement docs/metrics/qwen-wave/w3-ticket-12-active-queue-cap.md with active queue cap algorithm and promotion rules; verify with npm run build; expected signal: build exits 0.',
    };

    assert.equal(isSyntheticBenchmarkTicket(ticket), true);
    assert.equal(isOperationalTicket(ticket), false);
  });

  it('keeps product engineering tickets in the operational slice', () => {
    const ticket = {
      description:
        'Edit src/runtime.ts to improve undeclared-file plan-binding error text by appending a short declared-files preview and actionable next step; verify with npm test -- test/runtime.test.ts; expected signal: tests pass and error message includes declared plan files.',
    };

    assert.equal(isSyntheticBenchmarkTicket(ticket), false);
    assert.equal(isOperationalTicket(ticket), true);
  });
});