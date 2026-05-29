import type { TaskStatus } from '../../types.js';

export const retryableTicketStatuses: readonly TaskStatus[] = [
  'blocked',
  'failed',
  'stale',
  'cancelled',
];

export function isRetryableTicketStatus(status: TaskStatus): boolean {
  return retryableTicketStatuses.includes(status);
}

export function assertRetryableTicketStatus(status: TaskStatus, _context: string): void {
  if (!isRetryableTicketStatus(status)) {
    throw new Error(
      `Only blocked, failed, stale, or cancelled tickets can be retried. Current status: ${status}`
    );
  }
}

export function assertAmendedRetryDescription(
  amendedDescription: string | undefined,
  context: string
): void {
  if (amendedDescription === undefined) {
    return;
  }

  if (!amendedDescription.trim()) {
    throw new Error(`${context} must be a non-empty string.`);
  }
}