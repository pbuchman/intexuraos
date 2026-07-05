# Conversation Assistant Date Ranges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve Conversation Assistant analysis accuracy by adding year-bearing sent/imported message dates to the prompt transcript and by showing both selected information range and effective prompt-message range in the UI and PDF export.

**Architecture:** `whatsapp-service` remains the owner of private WhatsApp transcript projection, effective-range derivation, session persistence, public session DTOs, and PDF-export mapping. `@intexuraos/llm-prompts` owns the prompt header and transcript-facing date language, while `@intexuraos/infra-pdf-export` owns PDF metadata rendering. `apps/web` consumes the public session DTO and renders the two ranges in the session detail metadata and session shortcut cards.

**Tech Stack:** TypeScript strict mode, Fastify, Firestore, React/Vite/TailwindCSS, Vitest, `@intexuraos/llm-prompts`, `@intexuraos/infra-pdf-export`, `pnpm run ci:tracked`.

**Linear:** [INT-1852](https://linear.app/pbuchman/issue/INT-1852/improve-conversation-analysis-accuracy-and-date-range-visibility)
**Plan document:** `docs/plans/INT-1852-conversation-assistant-date-ranges.md`

## Global Constraints

- Planning artifact only; implementation must follow test-first development from `.claude/CLAUDE.md`.
- Do not rewrite historical frozen `transcriptText` values for existing sessions; preserve frozen context semantics.
- New sessions must persist `effectiveRange` from the first and last message actually included in the transcript prompt.
- Existing sessions without `effectiveRange` must remain readable by hydrating `effectiveRange` from the selected `range` as a legacy fallback.
- Transcript lines must include year-bearing sent and imported dates. Use `PrivateWhatsAppMessage.eventTimestamp` for sent date and `PrivateWhatsAppMessage.ingestedAt` for imported date.
- Prompt-visible dates must not expose raw ISO timestamps or second-level timestamp identifiers.
- Conversation Assistant prompt metadata must bump semver because prompt behavior changes.
- UI and PDF labels must distinguish `Information range` (selected by the user) from `Effective range` (first through last transcript message used in the prompt).
- Every touched HTTP endpoint must keep `logIncomingRequest()`.
- Plans with endpoint changes must include the `Endpoint Changes` section below.
- Before commit in implementation tasks, `pnpm run ci:tracked` must pass.

## Current State

- `apps/whatsapp-service/src/domain/conversation-assistant/transcriptFormatting.ts` formats transcript message labels as `[22 June]`, omitting the year and import date.
- `packages/llm-prompts/src/whatsapp-conversation-assistant/conversationAssistantPrompt.ts` formats prompt range labels as `1 June to 2 June`, omitting the year.
- `ConversationAssistantSession` stores only `range: { from, to }`, which is the user-selected information range, not the first and last message actually included in the transcript.
- `packages/infra-pdf-export` renders only `Source range`, using the selected range.
- `apps/web/src/components/whatsapp/ConversationAssistantSessionRail.tsx` and `apps/web/src/pages/WhatsAppConversationAssistantPage.tsx` use `formatDateTimeCompact()`, which omits the year.

## Endpoint Changes

| Type | Endpoint | Owner | Details |
| --- | --- | --- | --- |
| Modified | `POST /conversation-assistant/sessions` | `whatsapp-service` | Persist `effectiveRange` on the newly created session and return it in the public session DTO. |
| Modified | `GET /conversation-assistant/sessions` | `whatsapp-service` | Return each public session with `effectiveRange`, using selected `range` as the legacy fallback when stored data is absent. |
| Modified | `GET /conversation-assistant/sessions/:sessionId` | `whatsapp-service` | Return `effectiveRange` for the selected session. |
| Modified | `GET /conversation-assistant/sessions/:sessionId/export.pdf` | `whatsapp-service` | Pass both selected information range and effective range to the PDF exporter. |
| Modified | Web route `/whatsapp/conversation-assistant` | `apps/web` | Display both ranges in detail metadata and session shortcut cards with year-bearing labels. |
| Removed | None | - | No endpoint removal. |
| Unchanged | `POST /conversation-assistant/context/check`, turn submit, turn stream, and turn list endpoints | `whatsapp-service` | Context checking and turn persistence keep their current request shapes. |

## Shared Contract Changes

Add a reusable range shape where each package currently repeats `{ from: string; to: string }`:

```ts
export interface ConversationAssistantDateRange {
  from: string;
  to: string;
}
```

`ConversationAssistantSession` in `apps/whatsapp-service/src/domain/conversation-assistant/types.ts` must include:

```ts
range: ConversationAssistantDateRange;
effectiveRange: ConversationAssistantDateRange;
```

`apps/web/src/types/index.ts` must mirror the public DTO:

```ts
range: {
  from: string;
  to: string;
};
effectiveRange: {
  from: string;
  to: string;
};
```

`PdfConversationExportInput` in `packages/infra-pdf-export/src/types.ts` must include:

```ts
sourceRange: { from: string; to: string };
effectiveRange: { from: string; to: string };
```

The prompt input in `packages/llm-prompts/src/whatsapp-conversation-assistant/conversationAssistantPrompt.ts` must include:

```ts
range: { from: string; to: string };
effectiveRange: { from: string; to: string };
```

## Task 1: Add Year-Bearing Transcript Message Dates

**Files:**
- Modify: `apps/whatsapp-service/src/domain/conversation-assistant/transcriptFormatting.ts`
- Modify: `apps/whatsapp-service/src/__tests__/domain/conversation-assistant/transcriptFormatting.test.ts`

**Interfaces:**
- Consumes: `PrivateWhatsAppMessage.eventTimestamp`, `PrivateWhatsAppMessage.ingestedAt`.
- Produces: transcript lines with sent and imported date labels that include the year.

- [ ] **Step 1: Write failing transcript-formatting tests**

Extend `apps/whatsapp-service/src/__tests__/domain/conversation-assistant/transcriptFormatting.test.ts` so the first projection test expects `importedAt` on projected messages and a year-bearing transcript:

```ts
expect(result.messages[0]).toMatchObject({
  eventTimestamp: '2026-06-22T10:00:00.000Z',
  importedAt: '2026-06-22T10:00:02.000Z',
});

const expectedTranscript = [
  '[Sent 22 June 2026; imported 22 June 2026] Alice: hello from private chat',
  '[Sent 22 June 2026; imported 22 June 2026] You: voice transcript',
].join('\n');
expect(result.transcriptSha256).toBe(
  createHash('sha256').update(expectedTranscript).digest('hex')
);
```

Add an invalid-date assertion that keeps deterministic fallback text:

```ts
expect(transcriptText).toBe(
  '[Sent Unknown date; imported Unknown date] Alice: invalid timestamp text'
);
```

Run: `pnpm --filter whatsapp-service test -- src/__tests__/domain/conversation-assistant/transcriptFormatting.test.ts`

Expected: FAIL because `importedAt` and the new label format are not implemented.

- [ ] **Step 2: Add imported timestamp to the projected context message**

Modify `PrivateConversationContextMessage`:

```ts
export interface PrivateConversationContextMessage {
  id: string;
  eventTimestamp: string;
  importedAt: string;
  direction: PrivateWhatsAppMessageDirection;
  speakerLabel: string;
  messageType: PrivateWhatsAppMessageType;
  contentKind: 'text' | 'transcription';
  content: string;
  reactions?: PrivateWhatsAppReactionSummary[];
}
```

Modify `toContextMessage()` to copy the import timestamp:

```ts
const contextMessage: PrivateConversationContextMessage = {
  id: message.id,
  eventTimestamp: message.eventTimestamp,
  importedAt: message.ingestedAt,
  direction: message.direction,
  speakerLabel: speakerLabelFor(message),
  messageType: message.messageType,
  contentKind,
  content,
};
```

- [ ] **Step 3: Format sent and imported dates with years**

Replace transcript line construction with this shape:

```ts
return `[Sent ${formatTranscriptDateLabel(message.eventTimestamp)}; imported ${formatTranscriptDateLabel(message.importedAt)}] ${message.speakerLabel}: ${message.content}${reactionLine}`;
```

Update `formatTranscriptDateLabel()`:

```ts
return `${String(date.getUTCDate())} ${month} ${String(date.getUTCFullYear())}`;
```

Keep the existing `Unknown date` fallback.

- [ ] **Step 4: Verify transcript formatting**

Run: `pnpm --filter whatsapp-service test -- src/__tests__/domain/conversation-assistant/transcriptFormatting.test.ts`

Expected: PASS.

## Task 2: Persist and Expose Effective Range

**Files:**
- Modify: `apps/whatsapp-service/src/domain/conversation-assistant/types.ts`
- Modify: `apps/whatsapp-service/src/domain/conversation-assistant/sessionUseCases.ts`
- Modify: `apps/whatsapp-service/src/infra/firestore/conversationAssistantRepository.ts`
- Modify: `apps/whatsapp-service/src/__tests__/domain/conversation-assistant/sessionUseCases.test.ts`
- Modify: `apps/whatsapp-service/src/__tests__/infra/conversationAssistantRepository.test.ts`
- Modify: `apps/whatsapp-service/src/__tests__/conversationAssistantRoutes.test.ts`

**Interfaces:**
- Consumes: ordered `context.messages` from `projectPrivateConversationContext()`.
- Produces: `ConversationAssistantSession.effectiveRange` persisted and returned in public DTOs.

- [ ] **Step 1: Write failing use-case tests**

In `apps/whatsapp-service/src/__tests__/domain/conversation-assistant/sessionUseCases.test.ts`, seed at least two textual messages inside a wider selected range and assert the created session stores both ranges:

```ts
expect(result.value.session.range).toEqual({
  from: '2026-06-30T00:00:00.000Z',
  to: '2026-07-01T00:00:00.000Z',
});
expect(result.value.session.effectiveRange).toEqual({
  from: '2026-06-30T10:00:00.000Z',
  to: '2026-06-30T10:05:00.000Z',
});
```

Add a `maxMessages: 1` case so `effectiveRange.to` is the first included prompt message, not the last selected-range message:

```ts
expect(result.value.session.transcriptMessageCount).toBe(1);
expect(result.value.session.effectiveRange).toEqual({
  from: '2026-06-30T10:00:00.000Z',
  to: '2026-06-30T10:00:00.000Z',
});
expect(result.value.session.omitted.overLimit).toBeGreaterThan(0);
```

Run: `pnpm --filter whatsapp-service test -- src/__tests__/domain/conversation-assistant/sessionUseCases.test.ts`

Expected: FAIL because `effectiveRange` is absent and `maxMessages` is not threaded into projection.

- [ ] **Step 2: Add the session field and compute it from included transcript messages**

Add this helper in `sessionUseCases.ts`:

```ts
function deriveEffectiveRange(
  messages: readonly { eventTimestamp: string }[],
  fallback: { from: string; to: string }
): { from: string; to: string } {
  const first = messages[0];
  const last = messages.at(-1);
  if (first === undefined || last === undefined) {
    return fallback;
  }
  return { from: first.eventTimestamp, to: last.eventTimestamp };
}
```

When projecting context during creation, pass through the existing input cap:

```ts
const context = projectPrivateConversationContext({
  chat: chatLoadResult.value.chat,
  range: { from: input.from, to: input.to },
  messages,
  ...(input.maxMessages !== undefined ? { maxMessages: input.maxMessages } : {}),
});
```

Set the new session field:

```ts
effectiveRange: deriveEffectiveRange(context.messages, { from: input.from, to: input.to }),
```

- [ ] **Step 3: Add Firestore hydration fallback for existing sessions**

In `toSession()` inside `apps/whatsapp-service/src/infra/firestore/conversationAssistantRepository.ts`, hydrate legacy documents with the selected range:

```ts
const range = session?.range ?? { from: '', to: '' };
const projected: ConversationAssistantSession = {
  id,
  userId: session?.userId ?? '',
  chatId: session?.chatId ?? '',
  status: session?.status === 'archived' ? 'archived' : 'active',
  range,
  effectiveRange: session?.effectiveRange ?? range,
  model:
    typeof session?.model === 'string' && session.model.length > 0
      ? session.model
      : DEFAULT_CONVERSATION_ASSISTANT_MODEL,
  transcriptSha256: session?.transcriptSha256 ?? '',
  transcriptMessageCount: session?.transcriptMessageCount ?? 0,
  transcriptText: session?.transcriptText ?? '',
  omitted: session?.omitted ?? {
    mediaOnly: 0,
    failedTranscriptions: 0,
    pendingTranscriptions: 0,
    nonText: 0,
    overLimit: 0,
  },
  title: session?.title ?? '',
  createdAt: session?.createdAt ?? '',
  updatedAt: session?.updatedAt ?? '',
};
```

Add a repository test that stores a raw legacy document without `effectiveRange` and expects `effectiveRange` to equal `range`.

- [ ] **Step 4: Assert public route DTOs include the effective range**

Extend route tests in `apps/whatsapp-service/src/__tests__/conversationAssistantRoutes.test.ts`:

```ts
expect(body.data.session.effectiveRange).toEqual({
  from: '2026-06-30T10:00:00.000Z',
  to: '2026-06-30T10:00:00.000Z',
});
```

Also assert list and fetch responses include `effectiveRange` and still omit `transcriptText`.

- [ ] **Step 5: Verify backend session behavior**

Run:

```bash
pnpm --filter whatsapp-service test -- src/__tests__/domain/conversation-assistant/sessionUseCases.test.ts
pnpm --filter whatsapp-service test -- src/__tests__/infra/conversationAssistantRepository.test.ts
pnpm --filter whatsapp-service test -- src/__tests__/conversationAssistantRoutes.test.ts
```

Expected: PASS.

## Task 3: Update Prompt Dates and Prompt Metadata

**Files:**
- Modify: `packages/llm-prompts/src/whatsapp-conversation-assistant/conversationAssistantPrompt.ts`
- Modify: `packages/llm-prompts/src/whatsapp-conversation-assistant/__tests__/conversationAssistantPrompt.test.ts`
- Modify: `apps/whatsapp-service/src/domain/conversation-assistant/sessionUseCases.ts`
- Modify: `apps/whatsapp-service/src/__tests__/domain/conversation-assistant/sessionUseCases.test.ts`

**Interfaces:**
- Consumes: `session.range`, `session.effectiveRange`, frozen `session.transcriptText`.
- Produces: prompt messages with year-bearing information and effective ranges.

- [ ] **Step 1: Write failing prompt tests**

Update prompt tests so metadata version and date labels include years:

```ts
expect(WHATSAPP_CONVERSATION_ASSISTANT_PROMPT.version).toBe('3.0.0');
expect(JSON.stringify(messages)).toContain(
  'Information range: 1 June 2026 to 2 June 2026'
);
expect(JSON.stringify(messages)).toContain(
  'Effective range: 1 June 2026 to 1 June 2026'
);
expect(JSON.stringify(messages)).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
```

Use this input in the test:

```ts
effectiveRange: {
  from: '2026-06-01T10:00:00.000Z',
  to: '2026-06-01T11:00:00.000Z',
},
```

Run: `pnpm --filter @intexuraos/llm-prompts test -- src/whatsapp-conversation-assistant/__tests__/conversationAssistantPrompt.test.ts`

Expected: FAIL because the prompt input and labels have not changed.

- [ ] **Step 2: Update prompt input and system instruction**

Modify `WhatsAppConversationAssistantPromptInput`:

```ts
export interface WhatsAppConversationAssistantPromptInput {
  transcriptText: string;
  chatDisplayName?: string;
  range: { from: string; to: string };
  effectiveRange: { from: string; to: string };
  priorTurns: { role: 'user' | 'assistant'; text: string }[];
  question: string;
}
```

Bump prompt metadata:

```ts
export const WHATSAPP_CONVERSATION_ASSISTANT_PROMPT = {
  version: '3.0.0',
  promptType: 'whatsapp-conversation-assistant',
} as const;
```

Update the system instruction from day/month to day/month/year:

```ts
'When citing timing, cite only the day, month, and year, not exact times.',
```

- [ ] **Step 3: Render both ranges with year-bearing prompt labels**

Use this header text for the cached transcript introduction:

```ts
text: [
  `Conversation: ${input.chatDisplayName ?? 'selected WhatsApp chat'}`,
  `Information range: ${formatPromptDateLabel(input.range.from)} to ${formatPromptDateLabel(input.range.to)}`,
  `Effective range: ${formatPromptDateLabel(input.effectiveRange.from)} to ${formatPromptDateLabel(input.effectiveRange.to)}`,
  '',
  'Transcript follows:',
].join('\n'),
```

Update `formatPromptDateLabel()`:

```ts
return `${String(date.getUTCDate())} ${month} ${String(date.getUTCFullYear())}`;
```

- [ ] **Step 4: Pass effective range from session use cases**

In `buildPromptInputAfterUserTurn()` add:

```ts
effectiveRange: input.session.effectiveRange,
```

Extend use-case tests to inspect `llmClient.chatCalls[0]?.messages` and assert the first prompt contains `Information range:` and `Effective range:` with years.

- [ ] **Step 5: Verify prompt behavior**

Run:

```bash
pnpm --filter @intexuraos/llm-prompts test -- src/whatsapp-conversation-assistant/__tests__/conversationAssistantPrompt.test.ts
pnpm --filter whatsapp-service test -- src/__tests__/domain/conversation-assistant/sessionUseCases.test.ts
```

Expected: PASS.

## Task 4: Add Effective Range to PDF Export

**Files:**
- Modify: `packages/infra-pdf-export/src/types.ts`
- Modify: `packages/infra-pdf-export/src/conversationPdfExporter.ts`
- Modify: `packages/infra-pdf-export/src/__tests__/conversationPdfExporter.test.ts`
- Modify: `apps/whatsapp-service/src/domain/conversation-assistant/ports.ts`
- Modify: `apps/whatsapp-service/src/domain/conversation-assistant/sessionUseCases.ts`
- Modify: `apps/whatsapp-service/src/__tests__/domain/conversation-assistant/sessionUseCases.test.ts`
- Modify: `apps/whatsapp-service/src/__tests__/conversationAssistantRoutes.test.ts`

**Interfaces:**
- Consumes: `session.range`, `session.effectiveRange`.
- Produces: PDF metadata with both range labels.

- [ ] **Step 1: Write failing PDF package tests**

Extend `validInput` in `packages/infra-pdf-export/src/__tests__/conversationPdfExporter.test.ts`:

```ts
effectiveRange: {
  from: '2026-06-30T10:00:00.000Z',
  to: '2026-06-30T10:45:00.000Z',
},
```

Assert readable PDF text contains both labels:

```ts
expect(readablePdfText).toContain(
  'Information range: 2026-06-30T00:00:00.000Z to 2026-07-01T00:00:00.000Z'
);
expect(readablePdfText).toContain(
  'Effective range: 2026-06-30T10:00:00.000Z to 2026-06-30T10:45:00.000Z'
);
```

Add invalid input coverage:

```ts
{ ...validInput, effectiveRange: { from: '', to: validInput.effectiveRange.to } },
{ ...validInput, effectiveRange: { from: validInput.effectiveRange.from, to: '' } },
```

Run: `pnpm --filter @intexuraos/infra-pdf-export test -- src/__tests__/conversationPdfExporter.test.ts`

Expected: FAIL because the PDF input contract lacks `effectiveRange`.

- [ ] **Step 2: Update PDF input type, validation, and rendering**

Add `effectiveRange` to `PdfConversationExportInput` and validate it with the same non-empty rule as `sourceRange`.

Replace the existing `Source range` metadata line with:

```ts
drawMetadataLine(
  doc,
  contentWidth,
  'Information range',
  `${input.sourceRange.from} to ${input.sourceRange.to}`
);
drawMetadataLine(
  doc,
  contentWidth,
  'Effective range',
  `${input.effectiveRange.from} to ${input.effectiveRange.to}`
);
```

- [ ] **Step 3: Thread the field through the WhatsApp export port**

Add `effectiveRange` to `ConversationAssistantPdfExportInput` in `apps/whatsapp-service/src/domain/conversation-assistant/ports.ts`.

In `exportConversationAssistantSessionPdf()`, pass:

```ts
sourceRange: session.range,
effectiveRange: session.effectiveRange,
```

Extend the fake exporter assertions in use-case and route tests:

```ts
expect(pdfExporter.calls[0]?.sourceRange).toEqual(session.range);
expect(pdfExporter.calls[0]?.effectiveRange).toEqual(session.effectiveRange);
```

- [ ] **Step 4: Verify PDF export behavior**

Run:

```bash
pnpm --filter @intexuraos/infra-pdf-export test -- src/__tests__/conversationPdfExporter.test.ts
pnpm --filter whatsapp-service test -- src/__tests__/domain/conversation-assistant/sessionUseCases.test.ts
pnpm --filter whatsapp-service test -- src/__tests__/conversationAssistantRoutes.test.ts
```

Expected: PASS.

## Task 5: Show Both Ranges in the Web UI

**Files:**
- Modify: `apps/web/src/types/index.ts`
- Modify: `apps/web/src/components/whatsapp/ConversationAssistantSessionRail.tsx`
- Modify: `apps/web/src/pages/WhatsAppConversationAssistantPage.tsx`
- Modify: `apps/web/src/pages/__tests__/WhatsAppConversationAssistantPage.test.tsx`
- Modify: `apps/web/src/hooks/__tests__/useWhatsAppConversationAssistant.test.tsx` only where session fixtures require the new field.

**Interfaces:**
- Consumes: `ConversationAssistantSession.range`, `ConversationAssistantSession.effectiveRange`.
- Produces: year-bearing information/effective range labels in detail view and session shortcut cards.

- [ ] **Step 1: Write failing page tests**

Add `effectiveRange` to `createHookResult()` session fixtures:

```ts
effectiveRange: {
  from: '2026-06-20T09:30:00.000Z',
  to: '2026-06-21T09:45:00.000Z',
},
```

Extend the selected-session metadata test:

```ts
expect(screen.getByText('Information range')).toBeInTheDocument();
expect(screen.getByText('Effective range')).toBeInTheDocument();
expect(screen.getAllByText(/2026/).length).toBeGreaterThan(1);
```

Extend the session rail test by selecting the session button and asserting it contains both labels:

```ts
const sessionButton = screen.getByRole('button', { name: /Alice context/i });
expect(within(sessionButton).getByText(/Information/i)).toBeInTheDocument();
expect(within(sessionButton).getByText(/Effective/i)).toBeInTheDocument();
expect(sessionButton).toHaveTextContent('2026');
```

Run: `pnpm --filter web test -- src/pages/__tests__/WhatsAppConversationAssistantPage.test.tsx`

Expected: FAIL because the UI only renders one compact range and omits the year.

- [ ] **Step 2: Update web session type**

Add `effectiveRange` to `ConversationAssistantSession` in `apps/web/src/types/index.ts`:

```ts
effectiveRange: {
  from: string;
  to: string;
};
```

Update hook test fixtures that construct `ConversationAssistantSession` values to include `effectiveRange`. Use the same timestamps as `range` unless the test is specifically about range display.

- [ ] **Step 3: Use year-bearing range formatting**

In `ConversationAssistantSessionRail.tsx`, import `formatDateTime` instead of `formatDateTimeCompact` for range display:

```ts
function formatRange(range: { from: string; to: string }): string {
  return `${formatDateTime(range.from)} - ${formatDateTime(range.to)}`;
}
```

Render two rows:

```tsx
<span className="mt-1 flex min-w-0 items-start gap-1 text-xs text-slate-500 dark:text-slate-400">
  <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
  <span className="min-w-0">
    <span className="block font-medium text-slate-600 dark:text-slate-300">Information</span>
    <span className="block truncate">{formatRange(session.range)}</span>
  </span>
</span>
<span className="mt-1 flex min-w-0 items-start gap-1 text-xs text-slate-500 dark:text-slate-400">
  <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
  <span className="min-w-0">
    <span className="block font-medium text-slate-600 dark:text-slate-300">Effective</span>
    <span className="block truncate">{formatRange(session.effectiveRange)}</span>
  </span>
</span>
```

- [ ] **Step 4: Update selected-session metadata cards**

In `SessionMetadata`, replace the single `Range` card with two explicit cards:

```tsx
<div className="rounded-md border border-slate-200 px-3 py-2 dark:border-slate-800">
  <div className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
    Information range
  </div>
  <div className="mt-1 text-sm text-slate-950 dark:text-slate-50">
    {formatDateTime(session.range.from)} - {formatDateTime(session.range.to)}
  </div>
</div>
<div className="rounded-md border border-slate-200 px-3 py-2 dark:border-slate-800">
  <div className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
    Effective range
  </div>
  <div className="mt-1 text-sm text-slate-950 dark:text-slate-50">
    {formatDateTime(session.effectiveRange.from)} - {formatDateTime(session.effectiveRange.to)}
  </div>
</div>
```

Adjust the metadata grid from four columns to five columns on wide screens:

```tsx
className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-5"
```

Update the empty state to include both range slots:

```tsx
<div className="rounded-md border border-slate-200 px-3 py-2 dark:border-slate-800">No information range</div>
<div className="rounded-md border border-slate-200 px-3 py-2 dark:border-slate-800">No effective range</div>
```

- [ ] **Step 5: Verify web behavior**

Run:

```bash
pnpm --filter web test -- src/pages/__tests__/WhatsAppConversationAssistantPage.test.tsx
pnpm --filter web test -- src/hooks/__tests__/useWhatsAppConversationAssistant.test.tsx
```

Expected: PASS.

## Task 6: Final Integration Verification

**Files:**
- No additional source files beyond Tasks 1-5.

**Interfaces:**
- Verifies backend, package, and web contracts together.

- [ ] **Step 1: Run focused tests**

Run:

```bash
pnpm --filter whatsapp-service test -- src/__tests__/domain/conversation-assistant/transcriptFormatting.test.ts
pnpm --filter whatsapp-service test -- src/__tests__/domain/conversation-assistant/sessionUseCases.test.ts
pnpm --filter whatsapp-service test -- src/__tests__/infra/conversationAssistantRepository.test.ts
pnpm --filter whatsapp-service test -- src/__tests__/conversationAssistantRoutes.test.ts
pnpm --filter @intexuraos/llm-prompts test -- src/whatsapp-conversation-assistant/__tests__/conversationAssistantPrompt.test.ts
pnpm --filter @intexuraos/infra-pdf-export test -- src/__tests__/conversationPdfExporter.test.ts
pnpm --filter web test -- src/pages/__tests__/WhatsAppConversationAssistantPage.test.tsx
pnpm --filter web test -- src/hooks/__tests__/useWhatsAppConversationAssistant.test.tsx
```

Expected: all listed focused tests pass.

- [ ] **Step 2: Run tracked CI**

Run:

```bash
pnpm run ci:tracked
```

Expected: PASS before commit.

## Self-Review

- Spec coverage: The plan covers prompt transcript year/imported date, selected information range, effective prompt-message range, PDF export, detail UI, and session shortcut cards.
- Placeholder scan: The plan contains concrete file paths, expected labels, field names, and verification commands.
- Type consistency: `effectiveRange` is added consistently to backend session types, public web types, prompt input, and PDF export input.
