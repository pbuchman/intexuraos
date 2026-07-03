# Conversation Assistant PDF Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add PDF export for WhatsApp Conversation Assistant sessions so a user can download a current conversation snapshot from the web assistant page.

**Architecture:** Add a reusable Node PDF infrastructure package that owns PDFKit rendering and exposes a generic conversation export interface. `whatsapp-service` maps an authenticated Conversation Assistant session plus persisted turns into that package contract and serves a binary PDF endpoint. `apps/web` adds a selected-session export action that downloads the backend-generated PDF at click time.

**Tech Stack:** TypeScript strict mode, Fastify, React/Vite/TailwindCSS, Vitest, PDFKit `0.19.1`, `@types/pdfkit` `0.17.6`, `@intexuraos/common-core`, `pnpm run ci:tracked`.

**Linear:** [INT-1837](https://linear.app/pbuchman/issue/INT-1837/allow-exporting-conversation-assistant-chats-to-pdf)
**Plan document:** `docs/plans/INT-1837-conversation-pdf-export.md`

## Global Constraints

- Planning artifact only; implementation must follow test-first development from `.claude/CLAUDE.md`.
- The export source is the Conversation Assistant session snapshot at export request time.
- PDF content must include the session title, selected source-message time range, number of messages taken under consideration, number of messages excluded, assistant messages, and user messages.
- PDF output must be A4, simple, modern, full-width within normal page margins, and must not truncate message text.
- `whatsapp-service` remains the owner of Conversation Assistant export authorization and data mapping.
- The web app must not render PDF client-side; it downloads the WhatsApp service PDF response.
- Every new HTTP endpoint must call `logIncomingRequest()`.
- Binary PDF responses may use `reply.send(buffer)` only with an adjacent `@allow-raw-send` comment naming the binary response reason.
- New packages must use source exports only and must include both `packages/<name>/README.md` and `docs/packages/<name>/README.md`.
- Implementation agents must use subagents for the parallel subtasks below.
- Before commit in implementation tasks, `pnpm run ci:tracked` must pass.

## Parallel Breakdown

| Subtask | Owner boundary | Independent contract |
| --- | --- | --- |
| [INT-1838](https://linear.app/pbuchman/issue/INT-1838/build-reusable-pdf-conversation-export-package) | `packages/infra-pdf-export`, `docs/packages/infra-pdf-export` | Produces `PdfConversationExporter` and PDF DTO types. It imports no app code and can be tested with package-local fixtures. |
| [INT-1839](https://linear.app/pbuchman/issue/INT-1839/add-whatsapp-conversation-assistant-pdf-export-endpoint) | `apps/whatsapp-service` | Consumes the `@intexuraos/infra-pdf-export` contract, verifies session ownership, maps session/turn data, and exposes `GET /conversation-assistant/sessions/:sessionId/export.pdf`. |
| [INT-1840](https://linear.app/pbuchman/issue/INT-1840/add-conversation-assistant-pdf-export-control-to-web) | `apps/web` | Consumes the endpoint contract, adds authenticated binary download handling, and adds the selected-session export button. |

No Linear dependencies should be created between subtasks. Each subagent can work independently against the contracts in this document.

## Endpoint Changes

| Type | Endpoint | Owner | Details |
| --- | --- | --- | --- |
| Created | `GET /conversation-assistant/sessions/:sessionId/export.pdf` | `whatsapp-service` | Authenticated binary PDF export of the current persisted Conversation Assistant session snapshot. |
| Modified | Web route `/whatsapp/conversation-assistant` | `apps/web` | Adds a selected-session export button that downloads the PDF endpoint response. |
| Removed | None | - | No endpoint removal. |
| Unchanged | `POST /conversation-assistant/sessions`, `GET /conversation-assistant/sessions`, `GET /conversation-assistant/sessions/:sessionId`, `GET /conversation-assistant/sessions/:sessionId/turns`, turn submit/stream endpoints | `whatsapp-service` | Existing session and turn APIs keep their current JSON contracts. |

## Shared Contracts

### PDF Package Contract

`packages/infra-pdf-export/src/index.ts` must export:

```ts
export type { PdfConversationMessageRole, PdfConversationExportInput, PdfConversationExportResult, PdfConversationExporter, PdfExportError } from './types.js';
export { createPdfConversationExporter } from './conversationPdfExporter.js';
```

`packages/infra-pdf-export/src/types.ts` must define:

```ts
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
```

### WhatsApp Export Endpoint Contract

`GET /conversation-assistant/sessions/:sessionId/export.pdf`

Success response:

```http
HTTP/1.1 200 OK
Content-Type: application/pdf
Content-Disposition: attachment; filename="<sanitized-title>-<session-id>.pdf"
Cache-Control: no-store
```

Failure responses keep the standard API envelope through `reply.fail()`:

- `401` when unauthenticated.
- `404 NOT_FOUND` when the session is missing or belongs to another user.
- `500 INTERNAL_ERROR` when PDF rendering fails.

### Web Download Contract

`apps/web/src/services/conversationAssistantApi.ts` must expose:

```ts
export interface ConversationAssistantPdfDownload {
  blob: Blob;
  filename: string;
}

export async function exportConversationAssistantSessionPdf(
  accessToken: string,
  sessionId: string
): Promise<ConversationAssistantPdfDownload>;
```

The helper must parse `Content-Disposition` when present and fall back to `conversation-assistant-${sessionId}.pdf`.

## Task 1: PDF Infrastructure Package

**Files:**
- Create: `packages/infra-pdf-export/package.json`
- Create: `packages/infra-pdf-export/tsconfig.json`
- Create: `packages/infra-pdf-export/README.md`
- Create: `packages/infra-pdf-export/src/index.ts`
- Create: `packages/infra-pdf-export/src/types.ts`
- Create: `packages/infra-pdf-export/src/conversationPdfExporter.ts`
- Create: `packages/infra-pdf-export/src/__tests__/conversationPdfExporter.test.ts`
- Create: `docs/packages/infra-pdf-export/README.md`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: `PdfConversationExportInput`.
- Produces: `createPdfConversationExporter(): PdfConversationExporter`.

- [ ] **Step 1: Add the package manifest**

Create `packages/infra-pdf-export/package.json`:

```json
{
  "name": "@intexuraos/infra-pdf-export",
  "version": "3.8.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=22.0.0"
  },
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "lint:local": "eslint src --max-warnings 0"
  },
  "dependencies": {
    "@intexuraos/common-core": "workspace:*",
    "pdfkit": "^0.19.1"
  },
  "devDependencies": {
    "@types/pdfkit": "^0.17.6"
  }
}
```

Run: `pnpm install`

Expected: `pnpm-lock.yaml` records `pdfkit` and `@types/pdfkit`.

- [ ] **Step 2: Add TypeScript config and docs**

Create `packages/infra-pdf-export/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "rootDir": "src"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "src/__tests__"]
}
```

Create `packages/infra-pdf-export/README.md`:

```md
# @intexuraos/infra-pdf-export

Server-side PDF export helpers for conversation-style transcripts.

## Contract

- **Layer:** infra-wrapper
- **Dependencies:** `@intexuraos/common-core`, `pdfkit`
- **Exports:** `./src/index.ts` (source-exports; no `dist/` package output)

## Usage

```ts
import { createPdfConversationExporter } from '@intexuraos/infra-pdf-export';
```

For full API documentation, see [`docs/packages/infra-pdf-export/README.md`](../../docs/packages/infra-pdf-export/README.md).
```

Create `docs/packages/infra-pdf-export/README.md` with the exported interface and a note that consumers provide already-authorized, already-redacted conversation text.

- [ ] **Step 3: Write failing package tests**

Create `packages/infra-pdf-export/src/__tests__/conversationPdfExporter.test.ts` with tests that assert:

```ts
import { describe, expect, it } from 'vitest';
import { createPdfConversationExporter } from '../conversationPdfExporter.js';

describe('createPdfConversationExporter', () => {
  it('renders an A4 PDF conversation snapshot without truncating messages', async () => {
    const exporter = createPdfConversationExporter();
    const longUserText = 'User line '.repeat(120);
    const result = await exporter.exportConversation({
      title: 'Alice context',
      generatedAt: '2026-07-03T16:00:00.000Z',
      sourceRange: {
        from: '2026-06-30T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
      },
      messageCounts: { included: 9, excluded: 6 },
      omittedBreakdown: {
        mediaOnly: 2,
        failedTranscriptions: 1,
        pendingTranscriptions: 0,
        nonText: 3,
        overLimit: 0,
      },
      messages: [
        { role: 'user', createdAt: '2026-07-03T16:01:00.000Z', text: longUserText },
        { role: 'assistant', createdAt: '2026-07-03T16:02:00.000Z', text: 'Assistant answer with\nmultiple lines.' },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.contentType).toBe('application/pdf');
    expect(result.value.fileName).toBe('alice-context.pdf');
    expect(result.value.bytes.subarray(0, 5).toString('utf8')).toBe('%PDF-');
    const pdfText = result.value.bytes.toString('latin1');
    expect(pdfText).toContain('Alice context');
    expect(pdfText).toContain('Messages taken under consideration');
    expect(pdfText).toContain('Messages excluded');
    expect(pdfText).toContain('Assistant answer with');
    expect(pdfText).toContain('User line User line');
  });

  it('rejects empty titles and empty message text', async () => {
    const exporter = createPdfConversationExporter();
    const result = await exporter.exportConversation({
      title: ' ',
      generatedAt: '2026-07-03T16:00:00.000Z',
      sourceRange: { from: '2026-06-30T00:00:00.000Z', to: '2026-07-01T00:00:00.000Z' },
      messageCounts: { included: 0, excluded: 0 },
      messages: [{ role: 'user', createdAt: '2026-07-03T16:01:00.000Z', text: '' }],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_INPUT');
  });
});
```

Run: `pnpm vitest run packages/infra-pdf-export/src/__tests__/conversationPdfExporter.test.ts`

Expected: FAIL because the package code does not exist yet.

- [ ] **Step 4: Implement the package contract**

Implement `types.ts`, `index.ts`, and `conversationPdfExporter.ts` so that:

- PDFKit uses `size: 'A4'`, `margin: 36`, and `compress: false`.
- The text column uses the full page width minus margins.
- Header includes title and generated timestamp.
- Metadata includes source range, included count, excluded count, and omitted breakdown.
- Message sections render every `messages[n].text` with `whitespace` preserved by `doc.text(text, { width })`.
- Page breaks are inserted when the next block would overflow the bottom margin.
- `fileName` is a sanitized lowercase title plus `.pdf`, with non alphanumeric runs replaced by `-`.

Run: `pnpm vitest run packages/infra-pdf-export/src/__tests__/conversationPdfExporter.test.ts`

Expected: PASS.

- [ ] **Step 5: Verify package gates**

Run:

```bash
pnpm --filter @intexuraos/infra-pdf-export typecheck
pnpm --filter @intexuraos/infra-pdf-export lint:local
pnpm run verify:package-exports
```

Expected: PASS.

## Task 2: WhatsApp Service Export Endpoint

**Files:**
- Modify: `apps/whatsapp-service/package.json`
- Modify: `apps/whatsapp-service/src/domain/conversation-assistant/types.ts`
- Modify: `apps/whatsapp-service/src/domain/conversation-assistant/ports.ts`
- Modify: `apps/whatsapp-service/src/domain/conversation-assistant/sessionUseCases.ts`
- Modify: `apps/whatsapp-service/src/routes/conversationAssistantRoutes.ts`
- Modify: `apps/whatsapp-service/src/services.ts`
- Modify: `apps/whatsapp-service/src/__tests__/fakes.ts`
- Modify: `apps/whatsapp-service/src/__tests__/domain/conversation-assistant/sessionUseCases.test.ts`
- Modify: `apps/whatsapp-service/src/__tests__/conversationAssistantRoutes.test.ts`

**Interfaces:**
- Consumes: `PdfConversationExporter` from `@intexuraos/infra-pdf-export`.
- Produces: authenticated `GET /conversation-assistant/sessions/:sessionId/export.pdf`.

- [ ] **Step 1: Add the workspace dependency**

Modify `apps/whatsapp-service/package.json` dependencies:

```json
"@intexuraos/infra-pdf-export": "workspace:*"
```

Run: `pnpm run verify:workspace-deps`

Expected before imports are added: PASS.

- [ ] **Step 2: Write failing use-case tests**

Add tests to `apps/whatsapp-service/src/__tests__/domain/conversation-assistant/sessionUseCases.test.ts` for a new `exportConversationAssistantSessionPdf()` function:

```ts
it('exports an owned session and turns as a PDF snapshot input', async () => {
  const { deps, conversationRepository, pdfExporter, privateRepository } = makeDeps();
  await seedDirectMessage(privateRepository);
  const created = await createConversationAssistantSession(
    {
      userId: USER_ID,
      chatId: CHAT_ID,
      from: '2026-06-30T00:00:00.000Z',
      to: '2026-07-01T00:00:00.000Z',
      question: 'What was agreed?',
    },
    deps
  );
  expect(created.ok).toBe(true);
  if (!created.ok) return;

  const result = await exportConversationAssistantSessionPdf(
    { userId: USER_ID, sessionId: created.value.session.id },
    deps
  );

  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.contentType).toBe('application/pdf');
  expect(pdfExporter.exportCalls[0]).toMatchObject({
    title: created.value.session.title,
    messageCounts: { included: 1, excluded: 0 },
    messages: [
      { role: 'user', text: 'What was agreed?' },
      { role: 'assistant' },
    ],
  });
});
```

Also add tests for foreign-session `NOT_FOUND` and exporter failure mapped to `INTERNAL_ERROR`.

Run: `pnpm vitest run apps/whatsapp-service/src/__tests__/domain/conversation-assistant/sessionUseCases.test.ts -t "exports an owned session"`

Expected: FAIL because the export function and PDF dependency do not exist yet.

- [ ] **Step 3: Add domain types and port wiring**

In `types.ts`, add:

```ts
export interface ExportConversationAssistantSessionPdfInput {
  userId: string;
  sessionId: string;
}

export interface ConversationAssistantPdfExport {
  bytes: Buffer;
  fileName: string;
  contentType: 'application/pdf';
}
```

In `ports.ts`, extend `ConversationAssistantDeps`:

```ts
import type { PdfConversationExporter } from '@intexuraos/infra-pdf-export';

export interface ConversationAssistantDeps {
  repository: ConversationAssistantRepository;
  privateWhatsAppRepository: import('../whatsapp/index.js').PrivateWhatsAppRepository;
  llmClientFactory: ConversationAssistantLlmClientFactory;
  pdfExporter: PdfConversationExporter;
  model: string;
  clock: ConversationAssistantClock;
  ids: ConversationAssistantIdGenerator;
}
```

- [ ] **Step 4: Implement export use-case mapping**

Add `exportConversationAssistantSessionPdf()` to `sessionUseCases.ts`:

```ts
export async function exportConversationAssistantSessionPdf(
  input: ExportConversationAssistantSessionPdfInput,
  deps: ConversationAssistantDeps
): Promise<ConversationAssistantResult<ConversationAssistantPdfExport>> {
  const session = await deps.repository.getSessionById(input.sessionId);
  if (!isOwnedSession(session, input.userId)) {
    return err({ code: 'NOT_FOUND', message: 'Conversation Assistant session not found' });
  }

  const turns = await deps.repository.listTurnsBySessionId(session.id);
  const excluded =
    session.omitted.mediaOnly +
    session.omitted.failedTranscriptions +
    session.omitted.pendingTranscriptions +
    session.omitted.nonText +
    session.omitted.overLimit;

  const pdfResult = await deps.pdfExporter.exportConversation({
    title: session.title,
    generatedAt: deps.clock.now(),
    sourceRange: session.range,
    messageCounts: {
      included: session.transcriptMessageCount,
      excluded,
    },
    omittedBreakdown: session.omitted,
    messages: turns.map((turn) => ({
      role: turn.role,
      createdAt: turn.createdAt,
      text: turn.text,
    })),
  });

  if (!pdfResult.ok) {
    return err({ code: 'INTERNAL_ERROR', message: pdfResult.error.message });
  }

  const baseName = pdfResult.value.fileName.replace(/\.pdf$/i, '');
  return ok({
    ...pdfResult.value,
    fileName: `${baseName}-${session.id}.pdf`,
  });
}
```

Run the use-case tests again.

Expected: PASS.

- [ ] **Step 5: Write failing route tests**

Add route tests in `apps/whatsapp-service/src/__tests__/conversationAssistantRoutes.test.ts`:

- authenticated export returns status `200`.
- `content-type` contains `application/pdf`.
- `content-disposition` contains `attachment` and a filename ending in `-${sessionId}.pdf`.
- `cache-control` is `no-store`.
- body starts with `%PDF-` or the fake exporter bytes.
- unauthenticated export returns `401`.
- foreign session export returns `404`.

Run: `pnpm vitest run apps/whatsapp-service/src/__tests__/conversationAssistantRoutes.test.ts -t "exports a selected conversation assistant session"`

Expected: FAIL because the route does not exist.

- [ ] **Step 6: Add the binary route**

In `conversationAssistantRoutes.ts`, import `exportConversationAssistantSessionPdf` and add:

```ts
fastify.get<{ Params: SessionParams }>(
  '/conversation-assistant/sessions/:sessionId/export.pdf',
  {
    schema: {
      operationId: 'exportWhatsAppConversationAssistantSessionPdf',
      tags: ['whatsapp'],
      response: {
        200: {
          description: 'Conversation Assistant PDF export',
          type: 'string',
          format: 'binary',
        },
        401: errorResponse('Unauthorized'),
        404: errorResponse('Not found'),
        500: errorResponse('Internal error'),
      },
    },
  },
  async (request, reply) => {
    logIncomingRequest(request, {
      message: 'Received request to GET /whatsapp/conversation-assistant/sessions/:sessionId/export.pdf',
      bodyPreviewLength: 0,
      additionalFields: { route: 'whatsapp_conversation_assistant_export_pdf' },
    });
    const user = await requireAuth(request, reply);
    if (user === null) return;
    const deps = await getConversationAssistantDeps(reply);
    if (deps === null) return;

    const result = await safeCall(() =>
      exportConversationAssistantSessionPdf(
        { userId: user.userId, sessionId: request.params.sessionId },
        deps
      )
    );
    if (!result.ok) {
      return await sendConversationAssistantError(reply, result.error);
    }

    void reply.header('Content-Type', result.value.contentType);
    void reply.header('Content-Disposition', `attachment; filename="${result.value.fileName}"`);
    void reply.header('Cache-Control', 'no-store');
    // @allow-raw-send: Conversation Assistant PDF export is a binary response.
    return await reply.send(result.value.bytes);
  }
);
```

Run the route tests again.

Expected: PASS.

- [ ] **Step 7: Wire the real exporter**

In `services.ts`:

```ts
import { createPdfConversationExporter } from '@intexuraos/infra-pdf-export';
```

Add `pdfExporter?: import('@intexuraos/infra-pdf-export').PdfConversationExporter;` to `ServiceContainer`, set `pdfExporter: createPdfConversationExporter()` in `getServices()`, and include `pdfExporter: services.pdfExporter` in `getConversationAssistantDeps()` after checking it is configured.

Update `apps/whatsapp-service/src/__tests__/fakes.ts` test services to include a fake PDF exporter with an `exportCalls` array and deterministic PDF bytes. Ensure `makeDeps()` returns the fake as a separate `pdfExporter` property so tests can inspect `exportCalls` without accessing fake-only fields through the production `ConversationAssistantDeps` type.

Run:

```bash
pnpm vitest run apps/whatsapp-service/src/__tests__/domain/conversation-assistant/sessionUseCases.test.ts apps/whatsapp-service/src/__tests__/conversationAssistantRoutes.test.ts
pnpm --filter @intexuraos/whatsapp-service typecheck
pnpm --filter @intexuraos/whatsapp-service lint:local
```

Expected: PASS.

## Task 3: Web Export Control

**Files:**
- Modify: `apps/web/src/types/index.ts`
- Modify: `apps/web/src/services/conversationAssistantApi.ts`
- Modify: `apps/web/src/services/__tests__/conversationAssistantApi.test.ts`
- Modify: `apps/web/src/hooks/useWhatsAppConversationAssistant.ts`
- Modify: `apps/web/src/hooks/__tests__/useWhatsAppConversationAssistant.test.tsx`
- Modify: `apps/web/src/pages/WhatsAppConversationAssistantPage.tsx`
- Modify: `apps/web/src/pages/__tests__/WhatsAppConversationAssistantPage.test.tsx`

**Interfaces:**
- Consumes: `GET /conversation-assistant/sessions/:sessionId/export.pdf`.
- Produces: a visible export button and browser PDF download.

- [ ] **Step 1: Write failing API client tests**

In `conversationAssistantApi.test.ts`, add tests that:

- stub `fetch` with a `200` PDF response and `Content-Disposition: attachment; filename="alice-context.pdf"`;
- assert the helper calls the encoded session path;
- assert `{ blob, filename }` is returned;
- stub a JSON error envelope and assert `ApiError` is thrown;
- stub a missing filename and assert fallback `conversation-assistant-session-1.pdf`.

Run: `pnpm vitest run apps/web/src/services/__tests__/conversationAssistantApi.test.ts -t "exports conversation assistant PDF"`

Expected: FAIL because the helper does not exist.

- [ ] **Step 2: Add the API helper**

In `types/index.ts`, add:

```ts
export interface ConversationAssistantPdfDownload {
  blob: Blob;
  filename: string;
}
```

In `conversationAssistantApi.ts`, export `exportConversationAssistantSessionPdf()` using authenticated `fetch`. Reuse `getSessionPath(sessionId)` so IDs remain URL encoded. Parse error envelopes with the existing `toApiError()` helper. Add a local `parseAttachmentFilename()` function that supports `filename="name.pdf"` and `filename*=UTF-8''encoded.pdf`.

Run the API client tests again.

Expected: PASS.

- [ ] **Step 3: Write failing hook tests**

In `useWhatsAppConversationAssistant.test.tsx`, add tests that:

- `exporting` starts false.
- `exportSelectedSessionPdf()` calls `exportConversationAssistantSessionPdf(token, selectedSession.id)`.
- the hook creates an object URL, clicks a temporary anchor with `download` set to the returned filename, and revokes the object URL.
- when no selected session exists, the action sets an error and does not call the service helper.
- API failures clear `exporting` and set the displayed error.

Run: `pnpm vitest run apps/web/src/hooks/__tests__/useWhatsAppConversationAssistant.test.tsx -t "exports selected session PDF"`

Expected: FAIL because the hook state/action does not exist.

- [ ] **Step 4: Implement hook download state**

Extend `UseWhatsAppConversationAssistantResult`:

```ts
exporting: boolean;
exportSelectedSessionPdf: () => Promise<void>;
```

Add state:

```ts
const [exporting, setExporting] = useState(false);
const exportInFlightRef = useRef(false);
```

Implement:

```ts
const exportSelectedSessionPdf = useCallback(async (): Promise<void> => {
  if (exportInFlightRef.current) return;
  const session = selectedSession;
  if (session === undefined) {
    setError('Select an assistant session before exporting.');
    return;
  }

  exportInFlightRef.current = true;
  setExporting(true);
  setError(null);
  try {
    const token = await getAccessToken();
    const download = await exportConversationAssistantSessionPdf(token, session.id);
    const url = URL.createObjectURL(download.blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = download.filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    setError(getErrorMessage(err, 'Failed to export assistant session'));
  } finally {
    exportInFlightRef.current = false;
    setExporting(false);
  }
}, [getAccessToken, selectedSession]);
```

Return `exporting` and `exportSelectedSessionPdf` from the hook.

Run the hook tests again.

Expected: PASS.

- [ ] **Step 5: Write failing page tests**

In `WhatsAppConversationAssistantPage.test.tsx`, add tests that:

- no selected session disables the `Export PDF` button.
- selected session enables it.
- clicking it calls `assistant.exportSelectedSessionPdf()`.
- in-flight export shows loading text and disables the button.

Run: `pnpm vitest run apps/web/src/pages/__tests__/WhatsAppConversationAssistantPage.test.tsx -t "exports selected session"`

Expected: FAIL because the button is not rendered.

- [ ] **Step 6: Add the export button**

In `WhatsAppConversationAssistantPage.tsx`, import `Download` from `lucide-react`. Add a secondary button near the existing refresh action:

```tsx
<Button
  variant="secondary"
  size="sm"
  onClick={(): void => {
    void assistant.exportSelectedSessionPdf();
  }}
  isLoading={assistant.exporting}
  loadingText="Exporting"
  disabled={assistant.selectedSession === undefined || assistant.exporting}
>
  <Download className="mr-2 h-4 w-4" />
  Export PDF
</Button>
```

Keep the button in the first viewport of the Conversation Assistant page header and avoid changing the page route or session creation flow.

Run:

```bash
pnpm vitest run apps/web/src/services/__tests__/conversationAssistantApi.test.ts apps/web/src/hooks/__tests__/useWhatsAppConversationAssistant.test.tsx apps/web/src/pages/__tests__/WhatsAppConversationAssistantPage.test.tsx
pnpm --filter @intexuraos/web typecheck
pnpm --filter @intexuraos/web lint:local
```

Expected: PASS.

## Final Verification

Run from the repo root:

```bash
pnpm run verify:workspace:tracked -- @intexuraos/infra-pdf-export
pnpm run verify:workspace:tracked -- whatsapp-service
pnpm run verify:workspace:tracked -- web
pnpm run verify:package-exports
pnpm run verify:workspace-deps
pnpm run ci:tracked
```

Expected: all commands PASS before the implementation PR is ready.
