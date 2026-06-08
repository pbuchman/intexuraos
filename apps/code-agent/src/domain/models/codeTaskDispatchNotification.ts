import type { Timestamp } from '@google-cloud/firestore';
import type { CodeTaskDispatchStatusReason } from './codeTask.js';

export type CodeTaskDispatchNotificationChannel = 'whatsapp' | 'pr_comment' | 'task_log';
export type CodeTaskDispatchNotificationPhase =
  | 'waiting'
  | 'terminal'
  | 'timeout'
  | 'retry_expired'
  | 'retry_exhausted'
  | 'enqueue_failed';
export type CodeTaskDispatchNotificationStatus = 'reserved' | 'delivered' | 'failed';

export interface CodeTaskDispatchNotification {
  id: string;
  taskId: string;
  channel: CodeTaskDispatchNotificationChannel;
  reason: CodeTaskDispatchStatusReason;
  phase: CodeTaskDispatchNotificationPhase;
  status: CodeTaskDispatchNotificationStatus;
  attempts: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  lastError?: string;
}
