import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AdmissionController,
  createBackendAdmissionGate,
  createRepositoryAdmissionGate,
  createSafetyAdmissionGate,
  createToolRuntimeAdmissionGate,
} from '../src/admission.js';
import type { Task } from '../src/types.js';

const task: Task = {
  id: 'task_admission',
  description: 'Validate admission pipeline',
  status: 'pending',
  createdAt: new Date(),
};

describe('AdmissionController', () => {
  it('rejects work when backend readiness fails even if safety allows execution', async () => {
    const controller = new AdmissionController([
      createSafetyAdmissionGate({
        async shouldContinue() {
          return { allowed: true };
        },
      }),
      createBackendAdmissionGate({
        async checkHealth() {
          return { available: false, message: 'Ollama is down' };
        },
      }),
    ]);

    const decision = await controller.evaluate(task);

    assert.equal(decision.allowed, false);
    assert.equal(decision.reason, 'Ollama is down');
    assert.ok(decision.correlationId.startsWith('admission_'));
    assert.deepEqual(
      decision.issues.map((issue) => issue.code),
      ['backend-unavailable']
    );
  });

  it('keeps non-blocking repository and tool warnings while still allowing execution', async () => {
    const controller = new AdmissionController([
      createSafetyAdmissionGate({
        async shouldContinue() {
          return { allowed: true };
        },
      }),
      createRepositoryAdmissionGate({
        async getRepositoryReadiness() {
          return [
            {
              code: 'task-board-projection-unhealthy',
              message: 'Projection retry pending',
              blocking: false,
            },
          ];
        },
      }),
      createToolRuntimeAdmissionGate({
        async checkReadiness() {
          return { available: false, message: 'Workspace metadata unavailable' };
        },
      }),
    ]);

    const decision = await controller.evaluate(task);

    assert.equal(decision.allowed, true);
    assert.deepEqual(
      decision.issues.map((issue) => issue.code).sort(),
      ['task-board-projection-unhealthy', 'tool-runtime-unavailable'].sort()
    );
  });
});