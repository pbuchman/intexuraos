import { err, ok, type Result } from '@intexuraos/common-core';
import type { MobileNotificationsServiceClient } from '@intexuraos/internal-clients';
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

interface PromptEvidenceContext {
  promptEvidence: EvidenceItem[];
  promptSourceIds: string[];
  sourceIdAliases: ReadonlyMap<string, string>;
}

function deriveChatTitle(input: string): string {
  const trimmed = input.trim().replace(/\s+/g, ' ');
  return trimmed === '' ? DEFAULT_CHAT_TITLE : trimmed.slice(0, 120);
}

function createPromptEvidenceContext(evidence: EvidenceItem[]): PromptEvidenceContext {
  const sourceIdAliases = new Map<string, string>();
  const promptEvidence = evidence.map((item, index) => {
    const alias = `S${String(index + 1)}`;
    sourceIdAliases.set(alias, item.id);
    return {
      ...item,
      id: alias,
    };
  });

  return {
    promptEvidence,
    promptSourceIds: promptEvidence.map((item) => item.id),
    sourceIdAliases,
  };
}

function remapCitationAliases(
  citations: { sourceId: string; usedFor: string }[],
  sourceIdAliases: ReadonlyMap<string, string>
): { sourceId: string; usedFor: string }[] {
  return citations.map((citation) => {
    const canonicalSourceId = sourceIdAliases.get(citation.sourceId);
    if (canonicalSourceId === undefined) {
      return citation;
    }
    return {
      ...citation,
      sourceId: canonicalSourceId,
    };
  });
}

function buildRepairPrompt(input: {
  prompt: string;
  previousAnswer: string;
  failureMessage: string;
  promptSourceIds: string[];
}): string {
  return [
    input.prompt,
    'The previous answer was invalid.',
    `Validation error: ${input.failureMessage}`,
    `Allowed citation sourceIds: ${input.promptSourceIds.join(', ')}`,
    'Return strict JSON only.',
    'In citations[].sourceId, copy one allowed sourceId exactly as written. Do not translate, shorten, reorder, or invent sourceIds.',
    `Previous invalid answer:\n${input.previousAnswer}`,
  ].join('\n\n');
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
  promptSourceIds: string[];
  sourceIdAliases: ReadonlyMap<string, string>;
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
  const requireKnowledgeBaseCitation = input.evidence.some(
    (item) => item.sourceType === 'knowledge_page'
  );
  let repairReason = parsed.ok
    ? 'Fishing Assistant response failed citation validation.'
    : parsed.error.message;
  if (parsed.ok) {
    const validated = validateCitations(
      {
        ...parsed.value,
        citations: remapCitationAliases(parsed.value.citations, input.sourceIdAliases),
      },
      input.evidence,
      { requireKnowledgeBaseCitation }
    );
    if (validated.ok) {
      return ok({
        answerMarkdown: validated.value.answerMarkdown,
        confidence: validated.value.confidence,
        citations: buildCitations(validated.value.citations, input.evidence),
      });
    }
    repairReason = validated.error.message;
  }

  const repairPrompt = buildRepairPrompt({
    prompt: input.prompt,
    previousAnswer: first.value.content,
    failureMessage: repairReason,
    promptSourceIds: input.promptSourceIds,
  });
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

  const revalidated = validateCitations(
    {
      ...reparsed.value,
      citations: remapCitationAliases(reparsed.value.citations, input.sourceIdAliases),
    },
    input.evidence,
    { requireKnowledgeBaseCitation }
  );
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

  let answerMarkdown = 'I do not have enough evidence to answer that confidently.';
  let confidence: 'high' | 'medium' | 'low' = 'low';
  let citations: FishingMessageCitation[] = [];

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

  if (evidence.length > 0) {
    const promptEvidence = createPromptEvidenceContext(evidence);
    const answerResult = await generateValidatedAnswer({
      llmClient: chatClientResult.value,
      prompt: fishingAnswerPrompt.build({
        question: input.message,
        recentMessages: recentMessages.value,
        evidence: promptEvidence.promptEvidence,
      }),
      evidence,
      promptSourceIds: promptEvidence.promptSourceIds,
      sourceIdAliases: promptEvidence.sourceIdAliases,
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
