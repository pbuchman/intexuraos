import type { Result } from '@intexuraos/common-core';

export type PdfConversationMessageRole = 'user' | 'assistant';

export interface PdfConversationExportInput {
  title: string;
  generatedAt: string;
  sourceRange: { from: string; to: string };
  messageCounts: { included: number; excluded: number };
  omittedBreakdown?: {
    mediaOnly: number;
    failedTranscriptions: number;
    pendingTranscriptions: number;
    nonText: number;
    overLimit: number;
  };
  messages: {
    role: PdfConversationMessageRole;
    createdAt: string;
    text: string;
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
