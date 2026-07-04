# @intexuraos/infra-pdf-export

Reusable server-side PDF export for conversation transcripts.

## Purpose

This package owns PDF rendering only. It accepts already-selected transcript data and returns a binary PDF plus a deterministic base filename.
The filename is an ASCII slug derived from the title, falling back to `conversation-export.pdf` when the title has no ASCII slug characters.
It embeds Noto Sans TTF fonts from `@expo-google-fonts/noto-sans` so multilingual conversation text is not rendered with PDF standard font glyph limits.

## Public Surface

```ts
import type { Result } from '@intexuraos/common-core';

export type PdfConversationMessageRole = 'user' | 'assistant';

export interface PdfConversationExportInput {
  title: string;
  generatedAt: string;
  sourceRange: { from: string; to: string };
  messageCounts: { included: number; excluded: number };
  omittedBreakdown?: Record<string, number>;
  messages: Array<{
    role: PdfConversationMessageRole;
    createdAt: string;
    text: string;
  }>;
}

export interface PdfConversationExportResult {
  bytes: Buffer;
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

export function createPdfConversationExporter(): PdfConversationExporter;
```

## Ownership Boundary

- The consumer owns authentication and authorization.
- The consumer owns transcript selection and omitted-message accounting.
- The consumer owns redaction and any privacy filtering.
- This package only renders the provided conversation payload into a PDF.
