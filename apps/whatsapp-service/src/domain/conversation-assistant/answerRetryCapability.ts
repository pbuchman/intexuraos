export function isLatestRetryableConversationAssistantAnswer(input: {
  failed: boolean;
  errorCode: string | undefined;
  conversationRevision: number | undefined;
  completedConversationRevision: number | undefined;
  activeTurnRequestId: string | undefined;
  activeTurnLeaseExpiresAt: string | undefined;
  now: string;
}): boolean {
  const hasUnexpiredActiveLease =
    input.activeTurnRequestId !== undefined &&
    input.activeTurnLeaseExpiresAt !== undefined &&
    input.activeTurnLeaseExpiresAt > input.now;
  return (
    !hasUnexpiredActiveLease &&
    input.failed &&
    input.errorCode === 'LLM_ERROR' &&
    input.conversationRevision !== undefined &&
    input.completedConversationRevision !== undefined &&
    input.conversationRevision === input.completedConversationRevision
  );
}
