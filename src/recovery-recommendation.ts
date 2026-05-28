import { classifyFailureReason, type FailureClassification } from './failure-classification.js';
import type { TaskAttempt, TaskTicket } from './types.js';

export interface RecoveryRecommendation extends FailureClassification {
  source: 'artifact' | 'ticket-error' | 'none';
}

export function deriveRecoveryRecommendation(
  ticket: TaskTicket,
  attempts: TaskAttempt[]
): RecoveryRecommendation {
  const artifactClassification = findLatestFailureClassificationArtifact(attempts);
  if (artifactClassification) {
    return artifactClassification;
  }

  if (ticket.error) {
    return {
      ...classifyFailureReason(ticket.error),
      source: 'ticket-error',
    };
  }

  return {
    family: 'unknown',
    retryable: false,
    recommendation: 'No recovery recommendation is available yet because no failure evidence has been recorded.',
    source: 'none',
  };
}

function findLatestFailureClassificationArtifact(attempts: TaskAttempt[]): RecoveryRecommendation | null {
  for (const attempt of [...attempts].reverse()) {
    for (const artifact of [...attempt.artifacts].reverse()) {
      const parsed = parseFailureClassificationArtifact(artifact);
      if (parsed) {
        return parsed;
      }
    }
  }

  return null;
}

function parseFailureClassificationArtifact(artifact: string): RecoveryRecommendation | null {
  const familyMatch = artifact.match(/failure\.classification\s+([a-z-]+)/i);
  const retryableMatch = artifact.match(/retryable=(true|false)/i);
  const recommendationMatch = artifact.match(/recommendation=([^;]+)/i);

  if (!familyMatch || !retryableMatch || !recommendationMatch) {
    return null;
  }

  const family = familyMatch[1] as RecoveryRecommendation['family'];
  return {
    family,
    retryable: retryableMatch[1]?.toLowerCase() === 'true',
    recommendation: recommendationMatch[1]?.trim() ?? '',
    source: 'artifact',
  };
}
