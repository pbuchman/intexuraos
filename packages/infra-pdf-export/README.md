# @intexuraos/infra-pdf-export

Server-side PDF export helpers for conversation-style transcripts.

## Contract

- **Layer:** infra-wrapper
- **Dependencies:** `@intexuraos/common-core`, `@expo-google-fonts/noto-sans`, `pdfkit`
- **Exports:** `./src/index.ts` (source-exports; no `dist/` package output)

## Usage

```ts
import { createPdfConversationExporter } from '@intexuraos/infra-pdf-export';
```

For full API documentation, see [`docs/packages/infra-pdf-export/README.md`](../../docs/packages/infra-pdf-export/README.md).

## Authorization And Redaction

This package renders the text it is given. Authorization, transcript selection, and redaction remain the responsibility of the consumer before calling the exporter.
