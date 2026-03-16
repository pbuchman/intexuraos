/**
 * Dispatch retry domain model.
 *
 * Records failed webhook dispatches for retry by the drain queue processor.
 * Entries are created when a dispatch fails with a retryable error
 * (worker_unavailable, network_error) and processed by drainRetryQueue.
 */

import type { Timestamp } from '@google-cloud/firestore';

export interface DispatchRetry {
  id: string; // dr_<uuid>
  type: 'new_task' | 'task_message';
  eventId: string;
  repository: string;
  pullRequestNumber: number;
  senderLogin: string;
  // new_task fields
  taskId?: string;
  comment?: string;
  prTitle?: string;
  baseBranch?: string;
  // task_message fields (taskId shared above)
  userId?: string;
  message?: string;
  // Retry metadata
  attempts: number;
  maxAttempts: number;
  lastError: string;
  createdAt: Timestamp;
  lastAttemptAt?: Timestamp;
  ttlMinutes: number;
}

/**
 * Input for creating a new dispatch retry entry.
 * Omits auto-generated fields (id, createdAt).
 */
export interface CreateDispatchRetryInput {
  type: 'new_task' | 'task_message';
  eventId: string;
  repository: string;
  pullRequestNumber: number;
  senderLogin: string;
  taskId?: string;
  comment?: string;
  prTitle?: string;
  baseBranch?: string;
  userId?: string;
  message?: string;
  attempts: number;
  maxAttempts: number;
  lastError: string;
  ttlMinutes: number;
}
