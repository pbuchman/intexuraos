import { err, ok, type Result } from '@intexuraos/common-core';
import type {
  PrivateWhatsAppContextChange,
  PrivateWhatsAppMessage,
  PrivateWhatsAppRepository,
} from '../whatsapp/index.js';
import type { ConversationAssistantContextAttachmentDeltaBuilder } from './contextAttachmentPorts.js';
import { buildConversationAssistantContextAttachmentDelta } from './contextAttachmentDelta.js';

const SOURCE_SCAN_PAGE_SIZE = 5_000;
const JOURNAL_PAGE_SIZE = 400;
const PREPARATION_ERROR = {
  code: 'ATTACHMENT_PREPARATION_FAILED',
  message: 'The context attachment could not be prepared',
} as const;
const SOURCE_UNAVAILABLE_ERROR = {
  code: 'SOURCE_UNAVAILABLE',
  message: 'The source conversation is unavailable',
} as const;

export interface CreateConversationAssistantContextAttachmentDeltaBuilderInput {
  privateWhatsAppRepository: PrivateWhatsAppRepository;
  confirmationSecret: string;
  warningMessageThreshold: number;
  warningTokenThreshold: number;
}

export function createConversationAssistantContextAttachmentDeltaBuilder(
  deps: CreateConversationAssistantContextAttachmentDeltaBuilderInput
): ConversationAssistantContextAttachmentDeltaBuilder {
  return {
    async buildExactCutoffDelta({
      attachment,
    }): ReturnType<ConversationAssistantContextAttachmentDeltaBuilder['buildExactCutoffDelta']> {
      const accountResult =
        await deps.privateWhatsAppRepository.getActiveAccountBySourceAccountId(
          attachment.sourceAccountId
        );
      if (!accountResult.ok) return err(PREPARATION_ERROR);
      if (accountResult.value === null) return err(SOURCE_UNAVAILABLE_ERROR);
      if (
        accountResult.value.userId !== attachment.userId ||
        accountResult.value.sourceAccountId !== attachment.sourceAccountId ||
        accountResult.value.generationId !== attachment.sourceAccountGeneration ||
        accountResult.value.status !== 'active' ||
        accountResult.value.erasureStatus === 'erasing'
      ) {
        return err(SOURCE_UNAVAILABLE_ERROR);
      }

      const chatResult = await deps.privateWhatsAppRepository.getChatById({
        sourceAccountId: attachment.sourceAccountId,
        chatId: attachment.chatId,
      });
      if (!chatResult.ok) return err(PREPARATION_ERROR);
      if (chatResult.value === null) return err(SOURCE_UNAVAILABLE_ERROR);
      if (
        chatResult.value.userId !== attachment.userId ||
        chatResult.value.sourceAccountId !== attachment.sourceAccountId
      ) {
        return err(SOURCE_UNAVAILABLE_ERROR);
      }

      const scanned = await loadChronologicalExtension(attachment, deps.privateWhatsAppRepository);
      if (!scanned.ok) return scanned;

      const ownedChat = {
        userId: attachment.userId,
        sourceAccountId: attachment.sourceAccountId,
        chatId: attachment.chatId,
      };
      const observedHead = await deps.privateWhatsAppRepository.getConversationContextJournalHead(
        ownedChat
      );
      if (!observedHead.ok) return err(PREPARATION_ERROR);

      const journal = await loadJournalRange(
        {
          ...ownedChat,
          afterSequence: attachment.baseChangeSeq,
          throughSequence: observedHead.value,
        },
        deps.privateWhatsAppRepository
      );
      if (!journal.ok) return journal;

      const built = buildConversationAssistantContextAttachmentDelta({
        attachment,
        chat: chatResult.value,
        scannedMessages: scanned.value,
        journalChanges: journal.value,
        observedChangeSeq: observedHead.value,
        confirmationSecret: deps.confirmationSecret,
        warningMessageThreshold: deps.warningMessageThreshold,
        warningTokenThreshold: deps.warningTokenThreshold,
      });
      return built.ok ? ok(built.value) : err(built.error);
    },
  };
}

async function loadChronologicalExtension(
  attachment: Parameters<
    ConversationAssistantContextAttachmentDeltaBuilder['buildExactCutoffDelta']
  >[0]['attachment'],
  repository: PrivateWhatsAppRepository
): Promise<Result<PrivateWhatsAppMessage[], typeof PREPARATION_ERROR>> {
  const messages: PrivateWhatsAppMessage[] = [];
  let cursor: string | undefined;
  do {
    const page = await repository.findConversationContextMessages({
      sourceAccountId: attachment.sourceAccountId,
      chatId: attachment.chatId,
      from: attachment.baseEventThrough,
      to: attachment.capturedAt,
      limit: SOURCE_SCAN_PAGE_SIZE,
      ...(cursor === undefined ? {} : { cursor }),
    });
    if (!page.ok) return err(PREPARATION_ERROR);
    messages.push(...page.value.messages);
    const nextCursor = page.value.nextCursor;
    if (nextCursor !== undefined && nextCursor === cursor) {
      return err(PREPARATION_ERROR);
    }
    cursor = nextCursor;
  } while (cursor !== undefined);
  return ok(messages);
}

async function loadJournalRange(
  input: {
    userId: string;
    sourceAccountId: string;
    chatId: string;
    afterSequence: number;
    throughSequence: number;
  },
  repository: PrivateWhatsAppRepository
): Promise<Result<PrivateWhatsAppContextChange[], typeof PREPARATION_ERROR>> {
  const entries: PrivateWhatsAppContextChange[] = [];
  let afterSequence = input.afterSequence;
  while (afterSequence < input.throughSequence) {
    const page = await repository.findConversationContextJournalEntries({
      userId: input.userId,
      sourceAccountId: input.sourceAccountId,
      chatId: input.chatId,
      afterSequence,
      throughSequence: input.throughSequence,
      limit: JOURNAL_PAGE_SIZE,
    });
    if (!page.ok) return err(PREPARATION_ERROR);
    entries.push(...page.value.entries);
    const next = page.value.nextAfterSequence;
    if (next === undefined) break;
    if (next <= afterSequence) return err(PREPARATION_ERROR);
    afterSequence = next;
  }
  return ok(entries);
}
