import type { LlmGenerateClient } from '@intexuraos/llm-factory';
import type { ConversationAssistantDateRange, ConversationAssistantModel } from '@intexuraos/llm-contract';
import type { Result } from '@intexuraos/common-core';
import type {
  ConversationAssistantResult,
  ConversationAssistantSession,
  ConversationAssistantTurn,
  ConversationAssistantTurnRole,
  ExportConversationAssistantPdfResult,
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
  createLlmClientForUser(
    userId: string,
    model: ConversationAssistantModel | string
  ): Promise<ConversationAssistantResult<LlmGenerateClient>>;
}

export interface ConversationAssistantPdfExportInput {
  title: string;
  modelName: string;
  assistantRoleLabel: string;
  initialPrompt: string;
  generatedAt: string;
  sourceRange: ConversationAssistantDateRange;
  effectiveRange: ConversationAssistantDateRange;
  messageCounts: { included: number; excluded: number };
  omittedBreakdown?: Record<string, number>;
  messages: {
    role: ConversationAssistantTurnRole;
    createdAt: string;
    text: string;
  }[];
}

export interface ConversationAssistantPdfExportError {
  message: string;
}

export interface ConversationAssistantPdfExporter {
  exportConversation(
    input: ConversationAssistantPdfExportInput
  ): Promise<Result<ExportConversationAssistantPdfResult, ConversationAssistantPdfExportError>>;
}

export interface ConversationAssistantDeps {
  repository: ConversationAssistantRepository;
  privateWhatsAppRepository: import('../whatsapp/index.js').PrivateWhatsAppRepository;
  llmClientFactory: ConversationAssistantLlmClientFactory;
  pdfExporter?: ConversationAssistantPdfExporter;
  defaultModel: ConversationAssistantModel;
  clock: ConversationAssistantClock;
  ids: ConversationAssistantIdGenerator;
}
