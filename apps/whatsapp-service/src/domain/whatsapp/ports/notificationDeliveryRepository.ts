import type {
  NotificationContext,
  NotificationRunState,
  TransportConfirmation,
} from '@intexuraos/http-contracts';

export interface NotificationDeliveryRepository {
  register(input: {
    userId: string;
    source: string;
    runId: string;
    scheduledFor: string;
    now: string;
  }): Promise<{ marker: string }>;
  consume(input: {
    marker: string;
    userId: string;
    messageId: string;
    now: string;
  }): Promise<NotificationContext | null>;
  begin(input: {
    userId: string;
    correlationId: string;
    producerKey?: string;
    retryAuthorized?: boolean;
    idempotencyKey: string;
    replyToMessageId?: string;
    notificationContext?: NotificationContext;
    now: string;
  }): Promise<{ id: string; acquired: boolean }>;
  accepted(input: {
    intentId: string;
    phoneNumberId: string;
    wamid: string;
    at: string;
  }): Promise<void>;
  failed(input: {
    intentId: string;
    at: string;
    failureCode: string;
    retryable?: boolean;
  }): Promise<void>;
  recordReceipt(input: {
    phoneNumberId: string;
    wamid: string;
    status: 'sent' | 'delivered' | 'read' | 'failed';
    at: string;
    failureCode?: string;
  }): Promise<void>;
  getConfirmation(input: {
    userId: string;
    idempotencyKey: string;
  }): Promise<TransportConfirmation | undefined>;
  getDeliveryObservation(input: {
    userId: string;
    idempotencyKey: string;
  }): Promise<{ acceptedAt?: string; transportConfirmation: TransportConfirmation } | undefined>;
  getRun(input: { userId: string; source: string; runId: string }): Promise<NotificationRunState>;
  monitoring(now: string): Promise<{
    pendingCount: number;
    failedCount: number;
    oldestPendingScheduledFor: string | null;
    lastDeliveredAt: string | null;
  }>;
}
