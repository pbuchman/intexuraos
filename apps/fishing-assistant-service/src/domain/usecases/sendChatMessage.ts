import { err, ok, type Result } from '@intexuraos/common-core';
import type { LlmGenerateClient } from '@intexuraos/llm-factory';
import type {
  FishingChat,
  FishingChatMessage,
  FishingMessageCitation,
} from '../models/chat.js';
import type { FixedModelChatAdapter } from '../ports/chatModel.js';
import type {
  ChatRepositoryError,
  FishingChatRepository,
} from '../ports/chatRepository.js';
import type { KnowledgeEmbeddingClient } from '../ports/embeddingClient.js';
import type {
  KnowledgeChunkRepository,
  KnowledgePageRepository,
} from '../ports/knowledgeRepositories.js';
import { fishingAnswerPrompt } from '../prompts/buildFishingAnswerPrompt.js';
import { parseFishingAnswer } from '../prompts/parseFishingAnswer.js';
import { validateCitations } from '../prompts/validateCitations.js';
import { expandFollowUpEvidence } from '../retrieval/followUpExpansion.js';
import { retrieveEvidence } from '../retrieval/retrieveEvidence.js';
import type { EvidenceItem } from '../retrieval/types.js';
import type { MobileNotificationsServiceClient } from '@intexuraos/internal-clients';

const DEFAULT_CHAT_TITLE = 'New Chat';

export type SendChatMessageError =
  | ChatRepositoryError
  | { code: 'NO_API_KEY'; message: string }
  | { code: 'DOWNSTREAM_ERROR'; message: string }
  | { code: 'CITATION_VALIDATION_FAILED'; message: string };

export interface SendChatMessageDeps {
  chatRepository: FishingChatRepository;
  chatAdapter: FixedModelChatAdapter;
  embeddingClient: KnowledgeEmbeddingClient;
  chunkRepository: KnowledgeChunkRepository;
  pageRepository: KnowledgePageRepository;
  mobileNotificationsClient: Pick<
    MobileNotificationsServiceClient,
    'listDigestSubscriptions' | 'queryDigests' | 'queryGroupMessages'
  >;
  generateId: () => string;
  now: Date;
}

export interface SendChatMessageInput {
  userId: string;
  chatId: string;
  message: string;
}

function deriveChatTitle(input: string): string {
  const trimmed = input.trim().replace(/\s+/g, ' ');
  return trimmed === '' ? DEFAULT_CHAT_TITLE : trimmed.slice(0, 120);
}

function buildCitations(
  citations: { sourceId: string; usedFor: string }[],
  evidence: EvidenceItem[]
): FishingMessageCitation[] {
  return citations.flatMap((citation) => {
    const source = evidence.find((item) => item.id === citation.sourceId);
    /* v8 ignore start -- schema: validateCitations prior check guarantees cited sourceIds are known; missing-source branch is defensive @preserve */
    if (source === undefined) return [];
    /* v8 ignore stop @preserve */
    const pageId = source.metadata?.['pageId'];
    return [
      {
        sourceId: citation.sourceId,
        sourceType: source.sourceType,
        title: source.title,
        quote: source.quote,
        usedFor: citation.usedFor,
        ...(source.url !== undefined ? { url: source.url } : {}),
        ...(source.date !== undefined ? { date: source.date } : {}),
        ...(typeof pageId === 'string' ? { pageId } : {}),
      },
    ];
  });
}

async function generateValidatedAnswer(input: {
  llmClient: LlmGenerateClient;
  prompt: string;
  evidence: EvidenceItem[];
  chatId: string;
}): Promise<
  Result<
    {
      answerMarkdown: string;
      confidence: 'high' | 'medium' | 'low';
      citations: FishingMessageCitation[];
    },
    { code: 'CITATION_VALIDATION_FAILED'; message: string }
  >
> {
  const first = await input.llmClient.generate(input.prompt, {
    promptType: 'fishing-assistant-chat',
    correlation: { sessionId: input.chatId },
  });
  if (!first.ok) {
    return err({
      code: 'CITATION_VALIDATION_FAILED',
      message: first.error.message,
    });
  }

  const parsed = parseFishingAnswer(first.value.content);
  if (parsed.ok) {
    const validated = validateCitations(parsed.value, input.evidence);
    if (validated.ok) {
      return ok({
        answerMarkdown: validated.value.answerMarkdown,
        confidence: validated.value.confidence,
        citations: buildCitations(validated.value.citations, input.evidence),
      });
    }
  }

  const repairPrompt = `${input.prompt}\n\nRepair the previous answer so it is valid JSON and only cites known sourceIds.`;
  const repair = await input.llmClient.generate(repairPrompt, {
    promptType: 'fishing-assistant-chat-repair',
    correlation: { sessionId: input.chatId },
  });
  if (!repair.ok) {
    return err({
      code: 'CITATION_VALIDATION_FAILED',
      message: repair.error.message,
    });
  }

  const reparsed = parseFishingAnswer(repair.value.content);
  if (!reparsed.ok) {
    return err({
      code: 'CITATION_VALIDATION_FAILED',
      message: reparsed.error.message,
    });
  }

  const revalidated = validateCitations(reparsed.value, input.evidence);
  if (!revalidated.ok) {
    return revalidated;
  }

  return ok({
    answerMarkdown: revalidated.value.answerMarkdown,
    confidence: revalidated.value.confidence,
    citations: buildCitations(revalidated.value.citations, input.evidence),
  });
}

export async function sendChatMessage(
  deps: SendChatMessageDeps,
  input: SendChatMessageInput
): Promise<
  Result<
    { chat: FishingChat; message: FishingChatMessage },
    SendChatMessageError
  >
> {
  const chatResult = await deps.chatRepository.getChatByIdForUser({
    userId: input.userId,
    chatId: input.chatId,
  });
  if (!chatResult.ok) return chatResult;
  if (chatResult.value === null) {
    return err({ code: 'NOT_FOUND', message: `Fishing chat ${input.chatId} not found` });
  }

  const userMessage = await deps.chatRepository.createMessage({
    id: deps.generateId(),
    chatId: input.chatId,
    userId: input.userId,
    role: 'user',
    content: input.message,
  });
  if (!userMessage.ok) return userMessage;

  if (chatResult.value.title === DEFAULT_CHAT_TITLE) {
    const titleUpdate = await deps.chatRepository.updateChat({
      userId: input.userId,
      chatId: input.chatId,
      title: deriveChatTitle(input.message),
    });
    if (!titleUpdate.ok) return titleUpdate;
  }

  const recentMessages = await deps.chatRepository.listMessagesForChat({
    userId: input.userId,
    chatId: input.chatId,
  });
  if (!recentMessages.ok) return recentMessages;

  let evidence: EvidenceItem[] = [];
  const retrieved = await retrieveEvidence(
    {
      embeddingClient: deps.embeddingClient,
      chunkRepository: deps.chunkRepository,
      mobileNotificationsClient: deps.mobileNotificationsClient,
      now: deps.now,
    },
    {
      userId: input.userId,
      question: input.message,
    }
  );
  if (retrieved.ok) {
    evidence = retrieved.value;
  }

  const followUpEvidence = await expandFollowUpEvidence(
    { pageRepository: deps.pageRepository },
    {
      userId: input.userId,
      latestUserMessage: input.message,
      recentMessages: recentMessages.value,
    }
  );
  evidence = [...followUpEvidence, ...evidence];

  const chatClientResult = await deps.chatAdapter.createClientForUser(input.userId);
  if (!chatClientResult.ok) {
    if (chatClientResult.error.code === 'NO_API_KEY') {
      return err({
        code: 'NO_API_KEY',
        message: chatClientResult.error.message,
      });
    }
    return err({
      code: 'DOWNSTREAM_ERROR',
      message: chatClientResult.error.message,
    });
  }

  let answerMarkdown = 'I do not have enough evidence to answer that confidently.';
  let confidence: 'high' | 'medium' | 'low' = 'low';
  let citations: FishingMessageCitation[] = [];

  if (evidence.length > 0) {
    const answerResult = await generateValidatedAnswer({
      llmClient: chatClientResult.value,
      prompt: fishingAnswerPrompt.build({
        question: input.message,
        recentMessages: recentMessages.value,
        evidence,
      }),
      evidence,
      chatId: input.chatId,
    });
    if (!answerResult.ok) return answerResult;
    answerMarkdown = answerResult.value.answerMarkdown;
    confidence = answerResult.value.confidence;
    citations = answerResult.value.citations;
  }

  const assistantMessage = await deps.chatRepository.createMessage({
    id: deps.generateId(),
    chatId: input.chatId,
    userId: input.userId,
    role: 'assistant',
    content: answerMarkdown,
    citations,
    confidence,
  });
  if (!assistantMessage.ok) return assistantMessage;

  const updatedChat = await deps.chatRepository.getChatByIdForUser({
    userId: input.userId,
    chatId: input.chatId,
  });
  if (!updatedChat.ok) return updatedChat;
  if (updatedChat.value === null) {
    return err({ code: 'NOT_FOUND', message: `Fishing chat ${input.chatId} not found` });
  }

  return ok({
    chat: updatedChat.value,
    message: assistantMessage.value,
  });
}
