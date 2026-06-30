import type { LlmGenerateClient } from '@intexuraos/llm-factory';
import type {
  ConversationAssistantSession,
  ConversationAssistantTurn,
} from './types.js';

export interface ConversationAssistantRepository {
  saveSession(session: ConversationAssistantSession): Promise<void>;
  getSessionById(sessionId: string): Promise<ConversationAssistantSession | null>;
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

export interface ConversationAssistantDeps {
  repository: ConversationAssistantRepository;
  privateWhatsAppRepository: import('../whatsapp/index.js').PrivateWhatsAppRepository;
  llmClient: LlmGenerateClient;
  model: string;
  clock: ConversationAssistantClock;
  ids: ConversationAssistantIdGenerator;
}
