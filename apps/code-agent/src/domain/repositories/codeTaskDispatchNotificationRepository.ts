import type { Result } from '@intexuraos/common-core';
import type {
  CodeTaskDispatchNotificationChannel,
  CodeTaskDispatchNotificationPhase,
} from '../models/codeTaskDispatchNotification.js';
import type { CodeTaskDispatchStatusReason } from '../models/codeTask.js';

export type CodeTaskDispatchNotificationRepositoryError =
  | { code: 'FIRESTORE_ERROR'; message: string };

export interface ReserveDispatchNotificationInput {
  taskId: string;
  channel: CodeTaskDispatchNotificationChannel;
  reason: CodeTaskDispatchStatusReason;
  phase: CodeTaskDispatchNotificationPhase;
}

export interface ReserveDispatchNotificationResult {
  reserved: boolean;
  id: string;
}

export interface CodeTaskDispatchNotificationRepository {
  reserve(
    input: ReserveDispatchNotificationInput
  ): Promise<Result<ReserveDispatchNotificationResult, CodeTaskDispatchNotificationRepositoryError>>;
  markDelivered(id: string): Promise<Result<void, CodeTaskDispatchNotificationRepositoryError>>;
  markFailed(id: string, error: string): Promise<Result<void, CodeTaskDispatchNotificationRepositoryError>>;
}
