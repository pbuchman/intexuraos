import type {
  MessageDigestDefinition,
  MessageDigestDeliveryReadiness,
} from '@/types/messageDigests';

export type MessageDigestSourceAvailability =
  | 'loading'
  | 'active'
  | 'missing'
  | 'unavailable';

export interface MessageDigestLifecycleContext {
  sourceAvailability: MessageDigestSourceAvailability;
  sourceIsRefreshing: boolean;
  sourceAvailabilityError: string | null;
  deliveryReadiness: MessageDigestDeliveryReadiness | null;
  deliveryIsLoading: boolean;
  deliveryIsRefreshing: boolean;
  deliveryReadinessError: string | null;
}

export const MESSAGE_DIGEST_PENDING_RUN_RECOVERY_REASON =
  'Recover the pending Message Digest run before starting another.';
export const MESSAGE_DIGEST_PENDING_RUN_DELETE_REASON =
  'Recover the pending Message Digest run before deleting this digest.';

const SOURCE_RESUME_BLOCKERS = new Set([
  'SOURCE_NOT_FOUND',
  'SOURCE_UNAVAILABLE',
  'SOURCE_CHANGED',
]);

export function isMessageDigestSourceAttentionBlocker(
  attentionCode: string | null
): boolean {
  return attentionCode !== null && SOURCE_RESUME_BLOCKERS.has(attentionCode);
}

export function getMessageDigestLifecycleDisabledReason(
  definition: MessageDigestDefinition,
  context: MessageDigestLifecycleContext
): string | null {
  if (definition.status !== 'paused') return null;
  if (
    definition.latestRun?.generationStatus === 'queued' ||
    definition.latestRun?.generationStatus === 'processing'
  ) {
    return 'Wait for the current digest run to finish before resuming.';
  }
  if (isMessageDigestSourceAttentionBlocker(definition.attentionCode)) {
    return 'Choose an available source before resuming this digest.';
  }
  if (context.sourceAvailability === 'loading' || context.sourceIsRefreshing) {
    return 'Wait for the Private WhatsApp status check before resuming.';
  }
  if (context.sourceAvailability === 'missing') {
    return 'Connect Private WhatsApp before resuming this digest.';
  }
  if (
    context.sourceAvailability === 'unavailable' ||
    context.sourceAvailabilityError !== null
  ) {
    return 'Retry the Private WhatsApp status check before resuming.';
  }
  if (context.deliveryIsLoading || context.deliveryIsRefreshing) {
    return 'Wait for WhatsApp delivery checks before resuming this digest.';
  }
  if (context.deliveryReadinessError !== null || context.deliveryReadiness === null) {
    return 'Retry WhatsApp delivery checks before resuming this digest.';
  }
  if (context.deliveryReadiness.status === 'mapping_missing') {
    return 'Map a primary WhatsApp number before resuming this digest.';
  }
  if (context.deliveryReadiness.status === 'disconnected') {
    return 'Reconnect WhatsApp delivery before resuming this digest.';
  }
  if (context.deliveryReadiness.status === 'delivery_disabled') {
    return 'Enable WhatsApp delivery before resuming this digest.';
  }
  return null;
}

export function getMessageDigestRunDisabledReason(
  definition: MessageDigestDefinition,
  context: MessageDigestLifecycleContext
): string | null {
  if (definition.status === 'deleting') return 'Deletion is already in progress.';
  if (definition.status === 'paused') return 'Resume this digest before running it.';
  if (isMessageDigestSourceAttentionBlocker(definition.attentionCode)) {
    return 'Choose an available source before running this digest.';
  }
  if (context.sourceAvailability === 'loading' || context.sourceIsRefreshing) {
    return 'Wait for the Private WhatsApp status check before running.';
  }
  if (context.sourceAvailability === 'missing') {
    return 'Connect Private WhatsApp before running this digest.';
  }
  if (
    context.sourceAvailability === 'unavailable' ||
    context.sourceAvailabilityError !== null
  ) {
    return 'Retry the Private WhatsApp status check before running.';
  }
  if (context.deliveryIsLoading || context.deliveryIsRefreshing) {
    return 'Wait for WhatsApp delivery checks before running this digest.';
  }
  if (context.deliveryReadinessError !== null || context.deliveryReadiness === null) {
    return 'Confirm primary WhatsApp readiness before running this digest.';
  }
  if (context.deliveryReadiness.status === 'disconnected') {
    return 'Reconnect WhatsApp before running this digest.';
  }
  if (context.deliveryReadiness.status === 'mapping_missing') {
    return 'Map a primary WhatsApp number before running this digest.';
  }
  if (context.deliveryReadiness.status === 'delivery_disabled') {
    return 'Enable WhatsApp delivery before running this digest.';
  }
  return null;
}

export function getMessageDigestRunDisabledReasonWithRecoveryFence(
  definition: MessageDigestDefinition,
  context: MessageDigestLifecycleContext,
  pendingRunRecoveryDefinitionId: string | null
): string | null {
  if (
    pendingRunRecoveryDefinitionId !== null &&
    pendingRunRecoveryDefinitionId !== definition.id
  ) {
    return MESSAGE_DIGEST_PENDING_RUN_RECOVERY_REASON;
  }
  return getMessageDigestRunDisabledReason(definition, context);
}

export function getMessageDigestDeleteDisabledReason(
  definitionId: string,
  pendingRunRecoveryDefinitionId: string | null
): string | null {
  return pendingRunRecoveryDefinitionId === definitionId
    ? MESSAGE_DIGEST_PENDING_RUN_DELETE_REASON
    : null;
}
