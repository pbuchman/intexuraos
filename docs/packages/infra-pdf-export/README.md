# @intexuraos/infra-pdf-export

`@intexuraos/infra-pdf-export` renders already-authorized, already-redacted conversation snapshots into PDF files.

Consumers provide the title, source range, message counts, optional omitted-message breakdown, and chronological user/assistant messages. The package returns PDF bytes, an `application/pdf` content type, and a sanitized full filename including the `.pdf` extension.

## Exported API

```ts
import { createPdfConversationExporter } from '@intexuraos/infra-pdf-export';
import type {
  PdfConversationExporter,
  PdfConversationExportInput,
  PdfConversationExportResult,
  PdfExportError,
} from '@intexuraos/infra-pdf-export';
```

`createPdfConversationExporter()` returns a `PdfConversationExporter`:

```ts
interface PdfConversationExporter {
  exportConversation(
    input: PdfConversationExportInput
  ): Promise<Result<PdfConversationExportResult, PdfExportError>>;
}
```

## Input Contract

`PdfConversationExportInput` is the full persisted conversation snapshot to render. Callers must perform authorization and redaction before passing data to the exporter.

```ts
interface PdfConversationExportInput {
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
    role: 'user' | 'assistant';
    createdAt: string;
    text: string;
  }[];
}
```

- `title`, `generatedAt`, `sourceRange.from`, and `sourceRange.to` must be non-empty after trimming.
- `messageCounts.included` and `messageCounts.excluded` must be zero or positive.
- Each message must have non-empty `text`; empty transcripts should be filtered or represented by the caller before export.
- `messages` must be in the display order the PDF should use.

## Output Contract

On success, `exportConversation()` returns:

```ts
interface PdfConversationExportResult {
  bytes: Buffer;
  fileName: string;
  contentType: 'application/pdf';
}
```

`bytes` contains the rendered PDF. `fileName` is a sanitized lowercase filename derived from `title`, includes the `.pdf` extension, is capped to the exporter filename limit, and falls back to `conversation-assistant-export.pdf` when the sanitized title is empty.

## Errors

Failures are returned as `Result` errors instead of thrown exceptions:

```ts
interface PdfExportError {
  code: 'INVALID_INPUT' | 'RENDER_FAILED';
  message: string;
}
```

- `INVALID_INPUT` means the input contract was not satisfied.
- `RENDER_FAILED` means PDF rendering failed after validation.

## Usage

```ts
const exporter = createPdfConversationExporter();
const result = await exporter.exportConversation({
  title: 'Conversation with Alice',
  generatedAt: new Date().toISOString(),
  sourceRange: {
    from: '2026-07-01T00:00:00.000Z',
    to: '2026-07-03T23:59:59.999Z',
  },
  messageCounts: { included: 12, excluded: 3 },
  omittedBreakdown: {
    mediaOnly: 1,
    failedTranscriptions: 0,
    pendingTranscriptions: 0,
    nonText: 2,
    overLimit: 0,
  },
  messages: [
    {
      role: 'user',
      createdAt: '2026-07-03T16:01:00.000Z',
      text: 'Please summarize the appointment thread.',
    },
    {
      role: 'assistant',
      createdAt: '2026-07-03T16:02:00.000Z',
      text: 'The appointment is confirmed for Friday afternoon.',
    },
  ],
});

if (!result.ok) {
  return result;
}

return {
  bytes: result.value.bytes,
  contentType: result.value.contentType,
  fileName: result.value.fileName,
};
```
