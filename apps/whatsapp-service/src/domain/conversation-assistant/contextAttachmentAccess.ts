import type { Logger } from '@intexuraos/common-core';
import type { PrivateWhatsAppContextChange, PrivateWhatsAppRepository } from '../whatsapp/index.js';
import type {
  ConversationAssistantContextAttachmentAccessDeps,
  ConversationAssistantContextAttachmentAccessRepository,
  ConversationAssistantContextAttachmentClock,
  ConversationAssistantContextAttachmentPublicRetryDeps,
} from './contextAttachmentPorts.js';
import { countConversationAssistantContextAttachmentNewerAvailability } from './contextAttachmentNewerAvailability.js';
import {
  buildConversationAssistantContextAttachmentPreviewPage,
  type ConversationAssistantContextAttachmentPreviewPage,
} from './contextAttachmentPreview.js';
import { toPublicConversationAssistantContextAttachment } from './contextAttachmentUseCases.js';
import type {
  ConversationAssistantContextSnapshotSummary,
  ConversationAssistantSession,
  PublicConversationAssistantContextAttachment,
} from './types.js';

const CONTEXT_JOURNAL_PAGE_SIZE = 400;

export type GetConversationAssistantContextAttachmentStatusResult =
  | { kind: 'found'; attachment: PublicConversationAssistantContextAttachment }
  | { kind: 'not_found' }
  | { kind: 'source_unavailable' }
  | { kind: 'invalid'; code: 'INVALID_REQUEST' };

export type GetConversationAssistantContextAttachmentPreviewResult =
  | { kind: 'found'; page: ConversationAssistantContextAttachmentPreviewPage }
  | { kind: 'not_found' }
  | { kind: 'not_ready' }
  | { kind: 'invalid'; code: 'INVALID_REQUEST' | 'INVALID_CURSOR' };

export type DeleteConversationAssistantContextAttachmentDraftResult =
  | { kind: 'deleted' }
  | { kind: 'committed' }
  | { kind: 'not_found' }
  | { kind: 'invalid'; code: 'INVALID_REQUEST' };

export type ListConversationAssistantContextHistoryResult =
  | { kind: 'found'; snapshots: ConversationAssistantContextSnapshotSummary[] }
  | { kind: 'not_found' }
  | { kind: 'invalid'; code: 'INVALID_REQUEST' };

export type RetryConversationAssistantContextAttachmentForUserResult =
  | { kind: 'queued'; attachment: PublicConversationAssistantContextAttachment }
  | { kind: 'failed'; attachment: PublicConversationAssistantContextAttachment }
  | { kind: 'not_found' }
  | { kind: 'stale' }
  | { kind: 'expired' }
  | { kind: 'invalid_state' }
  | { kind: 'invalid'; code: 'INVALID_REQUEST' };

export async function getConversationAssistantContextAttachmentStatus(
  input: { userId: string; sessionId: string; attachmentId: string },
  deps: ConversationAssistantContextAttachmentAccessDeps,
  logger: Logger
): Promise<GetConversationAssistantContextAttachmentStatusResult> {
  const normalized = normalizeOwnedAttachmentInput(input);
  if (normalized === null) return { kind: 'invalid', code: 'INVALID_REQUEST' };
  const loaded = await deps.repository.getOwnedContextAttachment(normalized);
  if (loaded.status !== 'found') return { kind: 'not_found' };
  const sourceAccountStatus = await loadFrozenAttachmentSourceAccountStatus(
    loaded.attachment,
    deps.privateWhatsAppRepository
  );
  if (sourceAccountStatus === null) {
    logger.warn(
      { outcome: 'source_unavailable' },
      'Conversation Assistant context attachment availability'
    );
    return { kind: 'source_unavailable' };
  }
  if (isContextAttachmentExpired(loaded.attachment, deps.clock.now())) {
    return {
      kind: 'found',
      attachment: toPublicConversationAssistantContextAttachment(
        { ...loaded.attachment, status: 'expired' },
        {
          compatibility:
            loaded.attachment.baseContextVersion === loaded.currentContextVersion
              ? 'current'
              : 'stale',
          newerAvailableCount: 0,
          newerAvailableCorrectionCount: 0,
        }
      ),
    };
  }
  const newer =
    sourceAccountStatus === 'active'
      ? await loadNewerAvailability(loaded.attachment, deps.privateWhatsAppRepository)
      : null;
  if (sourceAccountStatus === 'disabled' || newer === null) {
    logger.warn(
      { outcome: 'source_unavailable' },
      'Conversation Assistant context attachment availability'
    );
  }
  return {
    kind: 'found',
    attachment: toPublicConversationAssistantContextAttachment(loaded.attachment, {
      compatibility:
        loaded.attachment.status === 'committed' ||
        loaded.attachment.baseContextVersion === loaded.currentContextVersion
          ? 'current'
          : 'stale',
      newerAvailableCount: newer?.messageCount ?? 0,
      newerAvailableCorrectionCount: newer?.correctionCount ?? 0,
    }),
  };
}

export async function getConversationAssistantContextAttachmentPreview(
  input: {
    userId: string;
    sessionId: string;
    attachmentId: string;
    cursor?: string;
    limit: number;
  },
  deps: {
    repository: ConversationAssistantContextAttachmentAccessRepository;
    clock: ConversationAssistantContextAttachmentClock;
  },
  logger: Logger
): Promise<GetConversationAssistantContextAttachmentPreviewResult> {
  const normalized = normalizeOwnedAttachmentInput(input);
  if (normalized === null) return { kind: 'invalid', code: 'INVALID_REQUEST' };
  const loaded = await deps.repository.loadOwnedContextAttachmentPreparedSnapshot({
    ...normalized,
    now: deps.clock.now(),
  });
  if (loaded.status !== 'found') {
    return loaded.status === 'not_found' ? { kind: 'not_found' } : { kind: 'not_ready' };
  }
  const page = buildConversationAssistantContextAttachmentPreviewPage({
    attachmentId: loaded.attachment.id,
    snapshot: loaded.snapshot,
    ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
    limit: input.limit,
  });
  if (!page.ok) return { kind: 'invalid', code: 'INVALID_CURSOR' };
  logger.info(
    { outcome: 'found', itemCount: page.value.items.length },
    'Conversation Assistant context attachment preview'
  );
  return { kind: 'found', page: page.value };
}

function isContextAttachmentExpired(
  attachment: Parameters<typeof toPublicConversationAssistantContextAttachment>[0],
  now: string
): boolean {
  return (
    attachment.status === 'expired' ||
    (attachment.status !== 'committed' &&
      attachment.expiresAt !== undefined &&
      Date.parse(attachment.expiresAt) <= Date.parse(now))
  );
}

export async function deleteConversationAssistantContextAttachmentDraft(
  input: { userId: string; sessionId: string; attachmentId: string },
  deps: { repository: ConversationAssistantContextAttachmentAccessRepository },
  logger: Logger
): Promise<DeleteConversationAssistantContextAttachmentDraftResult> {
  const normalized = normalizeOwnedAttachmentInput(input);
  if (normalized === null) return { kind: 'invalid', code: 'INVALID_REQUEST' };
  const deleted = await deps.repository.deleteOwnedContextAttachmentDraft(normalized);
  logger.info(
    { outcome: deleted.status },
    'Conversation Assistant context attachment draft deletion'
  );
  return { kind: deleted.status };
}

export async function listConversationAssistantContextHistory(
  input: { userId: string; sessionId: string },
  deps: { repository: ConversationAssistantContextAttachmentAccessRepository },
  logger: Logger
): Promise<ListConversationAssistantContextHistoryResult> {
  const userId = input.userId.trim();
  const sessionId = input.sessionId.trim();
  if (userId === '' || sessionId === '') return { kind: 'invalid', code: 'INVALID_REQUEST' };
  const history = await deps.repository.listOwnedContextHistory({ userId, sessionId });
  if (history.status !== 'found') return { kind: 'not_found' };
  logger.info(
    { outcome: 'found', snapshotCount: history.snapshots.length },
    'Conversation Assistant context history'
  );
  return { kind: 'found', snapshots: history.snapshots };
}

export async function retryConversationAssistantContextAttachmentForUser(
  input: { userId: string; sessionId: string; attachmentId: string },
  deps: ConversationAssistantContextAttachmentPublicRetryDeps,
  logger: Logger
): Promise<RetryConversationAssistantContextAttachmentForUserResult> {
  const normalized = normalizeOwnedAttachmentInput(input);
  if (normalized === null) return { kind: 'invalid', code: 'INVALID_REQUEST' };
  const loaded = await deps.repository.getOwnedContextAttachment(normalized);
  if (loaded.status !== 'found') return { kind: 'not_found' };
  const requeued = await deps.repository.requeueContextAttachmentPreparation({
    ...normalized,
    expectedSessionGenerationId: loaded.attachment.sessionGenerationId,
    updatedAt: deps.clock.now(),
  });
  if (requeued.status !== 'queued') return { kind: requeued.status };

  const publication = await deps.preparationPublisher.publish({
    type: 'whatsapp.conversation-assistant.context-attachment.prepare',
    userId: requeued.attachment.userId,
    sessionId: requeued.attachment.sessionId,
    sessionGenerationId: requeued.attachment.sessionGenerationId,
    attachmentId: requeued.attachment.id,
    attempt: requeued.attachment.preparationAttempt,
  });
  if (!publication.ok) {
    const failed = await deps.repository.failQueuedContextAttachmentPreparation({
      userId: requeued.attachment.userId,
      sessionId: requeued.attachment.sessionId,
      attachmentId: requeued.attachment.id,
      expectedSessionGenerationId: requeued.attachment.sessionGenerationId,
      attempt: requeued.attachment.preparationAttempt,
      error: publication.error,
    });
    if (failed.status === 'not_found') return { kind: 'not_found' };
    if (failed.status === 'stale') return { kind: 'stale' };
    logger.warn(
      { outcome: 'failed', errorCode: publication.error.code },
      'Conversation Assistant context attachment retry publication'
    );
    return {
      kind: 'failed',
      attachment: toPublicConversationAssistantContextAttachment(failed.attachment, {
        compatibility: 'current',
        newerAvailableCount: 0,
        newerAvailableCorrectionCount: 0,
      }),
    };
  }
  logger.info(
    { outcome: 'queued', attempt: requeued.attachment.preparationAttempt },
    'Conversation Assistant context attachment retry'
  );
  return {
    kind: 'queued',
    attachment: toPublicConversationAssistantContextAttachment(requeued.attachment, {
      compatibility:
        requeued.attachment.baseContextVersion === loaded.currentContextVersion
          ? 'current'
          : 'stale',
      newerAvailableCount: 0,
      newerAvailableCorrectionCount: 0,
    }),
  };
}

export async function resolveConversationAssistantContinuationState(
  session: ConversationAssistantSession,
  privateWhatsAppRepository: PrivateWhatsAppRepository,
  logger: Logger
): Promise<'available' | 'legacy_session' | 'source_unavailable'> {
  const continuation = session.continuation;
  if (continuation === undefined) return 'legacy_session';
  const account = await privateWhatsAppRepository.getActiveAccountBySourceAccountId(
    continuation.sourceAccountId
  );
  if (!account.ok || account.value?.userId !== session.userId) {
    logger.info(
      { outcome: 'source_unavailable' },
      'Conversation Assistant continuation availability'
    );
    return 'source_unavailable';
  }
  const chat = await privateWhatsAppRepository.getChatById({
    sourceAccountId: continuation.sourceAccountId,
    chatId: session.chatId,
  });
  if (
    !chat.ok ||
    chat.value?.userId !== session.userId ||
    chat.value.sourceAccountId !== continuation.sourceAccountId
  ) {
    logger.info(
      { outcome: 'source_unavailable' },
      'Conversation Assistant continuation availability'
    );
    return 'source_unavailable';
  }
  return 'available';
}

async function loadNewerAvailability(
  attachment: Parameters<typeof toPublicConversationAssistantContextAttachment>[0],
  repository: PrivateWhatsAppRepository
): Promise<{ messageCount: number; correctionCount: number } | null> {
  const chat = await repository.getChatById({
    sourceAccountId: attachment.sourceAccountId,
    chatId: attachment.chatId,
  });
  if (
    !chat.ok ||
    chat.value?.userId !== attachment.userId ||
    chat.value.sourceAccountId !== attachment.sourceAccountId
  ) {
    return null;
  }
  const head = await repository.getConversationContextJournalHead({
    userId: attachment.userId,
    sourceAccountId: attachment.sourceAccountId,
    chatId: attachment.chatId,
  });
  if (!head.ok || head.value < attachment.cutoffChangeSeq) return null;
  const changes: PrivateWhatsAppContextChange[] = [];
  let afterSequence = attachment.cutoffChangeSeq;
  while (afterSequence < head.value) {
    const page = await repository.findConversationContextJournalEntries({
      userId: attachment.userId,
      sourceAccountId: attachment.sourceAccountId,
      chatId: attachment.chatId,
      afterSequence,
      throughSequence: head.value,
      limit: CONTEXT_JOURNAL_PAGE_SIZE,
    });
    if (!page.ok) return null;
    changes.push(...page.value.entries);
    const next = page.value.nextAfterSequence;
    if (next === undefined) break;
    if (next <= afterSequence) return null;
    afterSequence = next;
  }
  const counted = countConversationAssistantContextAttachmentNewerAvailability({
    afterSequence: attachment.cutoffChangeSeq,
    throughSequence: head.value,
    initialContextFrom: attachment.initialContextFrom,
    changes,
  });
  return counted.ok ? counted.value : null;
}

async function loadFrozenAttachmentSourceAccountStatus(
  attachment: Parameters<typeof toPublicConversationAssistantContextAttachment>[0],
  repository: PrivateWhatsAppRepository
): Promise<'active' | 'disabled' | null> {
  const loaded = await repository.getAccountByUserId(attachment.userId);
  if (!loaded.ok || loaded.value === null) return null;
  const account = loaded.value;
  const generation = account.generationId ?? account.sourceAccountId;
  if (
    account.userId !== attachment.userId ||
    account.sourceAccountId !== attachment.sourceAccountId ||
    generation !== attachment.sourceAccountGeneration ||
    account.erasureStatus === 'erasing'
  ) {
    return null;
  }
  return account.status;
}

function normalizeOwnedAttachmentInput(input: {
  userId: string;
  sessionId: string;
  attachmentId: string;
}): { userId: string; sessionId: string; attachmentId: string } | null {
  const userId = input.userId.trim();
  const sessionId = input.sessionId.trim();
  const attachmentId = input.attachmentId.trim();
  return userId === '' || sessionId === '' || attachmentId === ''
    ? null
    : { userId, sessionId, attachmentId };
}
