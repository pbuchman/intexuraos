import type { Result } from '@intexuraos/common-core';
import type { ConversationAssistantDateRange } from '@intexuraos/llm-contract';

export type PdfConversationMessageRole = 'user' | 'assistant';

export interface PdfConversationContextAttachmentSummary {
  capturedAt: string;
  captureRange?: ConversationAssistantDateRange;
  eventRange?: ConversationAssistantDateRange;
  counts: {
    included: number;
    excluded: number;
    completedTranscriptions: number;
    edited: number;
    redacted: number;
    deleted: number;
    reactionsChanged: number;
    lateIngested: number;
  };
}

export interface PdfConversationCumulativeContextSummary {
  snapshotCount: number;
  counts: {
    included: number;
    omitted: number;
    completedTranscriptions: number;
    edited: number;
    redacted: number;
    deleted: number;
    reactionsChanged: number;
    lateIngested: number;
  };
}

export interface PdfConversationExportInput {
  title: string;
  modelName: string;
  assistantRoleLabel: string;
  initialPrompt: string;
  generatedAt: string;
  sourceRange: ConversationAssistantDateRange;
  effectiveRange: ConversationAssistantDateRange;
  messageCounts: { included: number; excluded: number };
  omittedBreakdown?: Record<string, number>;
  cumulativeContext?: PdfConversationCumulativeContextSummary;
  /** The immutable revision selected by the caller for this export. */
  completedConversationRevision?: number;
  messages: {
    role: PdfConversationMessageRole;
    createdAt: string;
    text: string;
    conversationRevision?: number;
    contextAttachment?: PdfConversationContextAttachmentSummary;
    acknowledgment?: string;
  }[];
}

export interface PdfConversationExportResult {
  bytes: Buffer;
  /** Sanitized full filename including the `.pdf` extension. */
  fileName: string;
  contentType: 'application/pdf';
}

export interface PdfExportError {
  code: 'INVALID_INPUT' | 'RENDER_FAILED';
  message: string;
}

export interface PdfConversationExporter {
  exportConversation(
    input: PdfConversationExportInput
  ): Promise<Result<PdfConversationExportResult, PdfExportError>>;
}
