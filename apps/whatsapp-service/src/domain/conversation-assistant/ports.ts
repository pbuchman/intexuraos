import type { LlmGenerateClient } from '@intexuraos/llm-factory';
import type { PdfConversationExporter } from '@intexuraos/infra-pdf-export';
import type {
  ConversationAssistantResult,
  ConversationAssistantSession,
  ConversationAssistantTurn,
} from './types.js';

export interface ConversationAssistantRepository {
  saveSession(session: ConversationAssistantSession): Promise<void>;
  getSessionById(sessionId: string): Promise<ConversationAssistantSession | null>;
  getSessionSnapshotById(
    input: { sessionId: string; userId: string }
  ): Promise<{ session: ConversationAssistantSession; turns: ConversationAssistantTurn[] } | null>;
  listSessionsByUserId(userId: string): Promise<ConversationAssistantSession[]>;
  saveTurn(turn: ConversationAssistantTurn): Promise<void>;
  listTurnsBySessionId(sessionId: string): Promise<ConversationAssistantTurn[]>;
}

export interface ConversationAssistantClock {
  now(): string;
}

export interface ConversationAssistantIdGenerator {
  sessionId(): string;
  turnId(): string;
}

export interface ConversationAssistantLlmClientFactory {
  createLlmClientForUser(userId: string): Promise<ConversationAssistantResult<LlmGenerateClient>>;
}

export interface ConversationAssistantDeps {
  repository: ConversationAssistantRepository;
  privateWhatsAppRepository: import('../whatsapp/index.js').PrivateWhatsAppRepository;
  llmClientFactory: ConversationAssistantLlmClientFactory;
  pdfExporter: PdfConversationExporter;
  model: string;
  clock: ConversationAssistantClock;
  ids: ConversationAssistantIdGenerator;
}
