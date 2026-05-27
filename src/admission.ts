import { randomUUID } from 'node:crypto';
import type { RepositoryReadinessProbe, ToolRuntimeReadinessProbe } from './repositories.js';
import type { Task } from './types.js';

export interface HealthChecker {
  checkHealth(): Promise<{ available: boolean; message: string }>;
}

export interface SafetyGate {
  shouldContinue(): Promise<{ allowed: boolean; reason?: string }>;
}

export interface AdmissionIssue {
  gate: string;
  severity: 'error' | 'warning';
  code: string;
  message: string;
}

export interface AdmissionDecision {
  allowed: boolean;
  reason?: string;
  issues: AdmissionIssue[];
  correlationId: string;
}

export interface AdmissionGate {
  readonly name: string;
  evaluate(task: Task): Promise<AdmissionIssue[]>;
}

export class AdmissionController {
  constructor(private readonly gates: AdmissionGate[]) {}

  async evaluate(task: Task): Promise<AdmissionDecision> {
    const correlationId = `admission_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const issues: AdmissionIssue[] = [];

    for (const gate of this.gates) {
      const gateIssues = await gate.evaluate(task);
      issues.push(...gateIssues);
    }

    const blockingIssue = issues.find((issue) => issue.severity === 'error');

    return {
      allowed: blockingIssue === undefined,
      reason: blockingIssue?.message,
      issues,
      correlationId,
    };
  }
}

export function createSafetyAdmissionGate(safety: SafetyGate): AdmissionGate {
  return {
    name: 'safety',
    async evaluate(): Promise<AdmissionIssue[]> {
      const decision = await safety.shouldContinue();
      if (decision.allowed) {
        return [];
      }

      return [
        {
          gate: 'safety',
          severity: 'error',
          code: 'safety-denied',
          message: decision.reason || 'Task rejected by safety policy.',
        },
      ];
    },
  };
}

export function createBackendAdmissionGate(healthChecker: HealthChecker): AdmissionGate {
  return {
    name: 'backend',
    async evaluate(): Promise<AdmissionIssue[]> {
      const health = await healthChecker.checkHealth();
      if (health.available) {
        return [];
      }

      return [
        {
          gate: 'backend',
          severity: 'error',
          code: 'backend-unavailable',
          message: health.message,
        },
      ];
    },
  };
}

export function createRepositoryAdmissionGate(repository: RepositoryReadinessProbe): AdmissionGate {
  return {
    name: 'repository',
    async evaluate(): Promise<AdmissionIssue[]> {
      const issues = await repository.getRepositoryReadiness();
      return issues.map((issue) => ({
        gate: 'repository',
        severity: issue.blocking ? 'error' : 'warning',
        code: issue.code,
        message: issue.message,
      }));
    },
  };
}

export function createToolRuntimeAdmissionGate(toolRuntime: ToolRuntimeReadinessProbe): AdmissionGate {
  return {
    name: 'tool-runtime',
    async evaluate(): Promise<AdmissionIssue[]> {
      const health = await toolRuntime.checkReadiness();
      if (health.available) {
        return [];
      }

      return [
        {
          gate: 'tool-runtime',
          severity: 'warning',
          code: 'tool-runtime-unavailable',
          message: health.message,
        },
      ];
    },
  };
}