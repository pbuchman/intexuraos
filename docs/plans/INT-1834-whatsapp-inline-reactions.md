# WhatsApp Inline Reactions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display WhatsApp reactions together with the private WhatsApp messages they target, and keep Conversation Assistant transcripts from treating attached reactions as standalone user messages.

**Architecture:** Normalize reaction target metadata at private WhatsApp ingest, store a safe internal `targetMessageId`, and enrich private message read responses with inline reaction summaries. The web log renders reaction chips on target message bubbles, while Conversation Assistant transcript projection folds reactions into the referenced message when both are in the selected context range.

**Tech Stack:** TypeScript strict mode, Fastify, Firestore, React/Vite/TailwindCSS, Vitest, existing private WhatsApp repository and Conversation Assistant domain code.

## Global Constraints

- Planning artifact only; implementation must follow test-first development from `.claude/CLAUDE.md`.
- Do not expose `matrixEventId`, `targetMatrixEventId`, `rawMatrixEvent`, or `matrixSenderId` through public web APIs.
- Keep `sourceAccountId` server-side only on authenticated private WhatsApp read routes.
- Preserve existing media, transcription, pagination, and day-filter behavior except for rendering attached reactions inline.
- Reaction display is read-model enrichment; do not backfill existing documents unless implementation proves read-time normalization cannot cover a case.
- Public Intex Agent assistant-message reaction handling is documented as a follow-up contract because it crosses WhatsApp webhook processing, `intex-agent` session events, and the Intex session web timeline.

---

## Scope Decision

This plan implements inline reactions for the Private WhatsApp log and the WhatsApp Conversation Assistant transcript source, both owned by `whatsapp-service` plus the existing web private log page.

Assistant messages are handled in two ways:

1. **Conversation Assistant web turns:** no reaction UI is added to `ConversationAssistantTurn` because those turns are not WhatsApp posts. Reactions from private WhatsApp context are folded into the frozen transcript line for the original private message when the target message and reaction are both in the selected range.
2. **Public Intex Agent outbound assistant messages:** `whatsapp-service` already extracts Cloud API reaction payloads and can resolve outbound assistant messages by `wamid`, but it currently ignores them. A follow-up should introduce an `intex.message.reaction` event and Intex session timeline rendering. That work is intentionally not mixed into the private-message display change.

## Endpoint Changes

| Status | Endpoint | Owner | Change |
|--------|----------|-------|--------|
| Modified | `GET /private/chats/:chatId/messages` | `whatsapp-service` | Returned message objects may include `reactions`; attached reaction rows are omitted from the top-level `messages` list when their target is present in the response page. |
| Modified | `GET /private/messages` | `whatsapp-service` | Same public message enrichment for sender/day reads. |
| Unchanged | `GET /conversation-assistant/*`, `POST /conversation-assistant/*` | `whatsapp-service` | API shape stays unchanged; transcript text generation changes internally. |
| Unchanged | Public WhatsApp message routes | `whatsapp-service` | Cloud API reaction webhooks remain ignored until the follow-up assistant-message reaction event is implemented. |

## Data Contract

Add private domain fields:

```ts
export interface PrivateWhatsAppReactionInfo {
  emoji: string;
  targetMatrixEventId: string;
  targetMessageId: string;
}

export interface PrivateWhatsAppReactionSummary {
  id: string;
  emoji: string;
  senderKey?: string;
  senderDisplayName?: string;
  senderPhoneNumber?: string;
  direction: PrivateWhatsAppMessageDirection;
  eventTimestamp: string;
}
```

`PrivateWhatsAppMessage` gains:

```ts
reaction?: PrivateWhatsAppReactionInfo;
reactions?: PrivateWhatsAppReactionSummary[];
```

Only `reactions` and a redacted `reaction?: { emoji: string; targetMessageId: string }` are allowed in public API output. `targetMessageId` is the existing deterministic private message id, not a Matrix id.

## Task 1: Normalize Private Reaction Metadata

**Files:**
- Modify: `apps/whatsapp-service/src/domain/whatsapp/models/PrivateWhatsApp.ts`
- Modify: `apps/whatsapp-service/src/domain/whatsapp/usecases/ingestPrivateWhatsAppEvents.ts`
- Test: `apps/whatsapp-service/src/__tests__/usecases/ingestPrivateWhatsAppEvents.test.ts`

**Interfaces:**
- Consumes: Matrix reaction events from either `message.reaction` or `rawMatrixEvent.content["m.relates_to"]`.
- Produces: `StorePrivateWhatsAppMessageInput.message.reaction` with `{ emoji, targetMatrixEventId }`.

- [ ] **Step 1: Add the failing ingest test**

Add this test to `apps/whatsapp-service/src/__tests__/usecases/ingestPrivateWhatsAppEvents.test.ts`:

```ts
it('normalizes Matrix reaction target metadata for private WhatsApp events', async () => {
  const repository = new TestPrivateWhatsAppRepository();
  const publisher = new TestEventPublisher();
  const useCase = new IngestPrivateWhatsAppEventsUseCase({
    privateWhatsAppRepository: repository,
    eventPublisher: publisher,
  });

  const result = await useCase.execute(
    createInput({
      events: [
        createEvent({
          matrixEventId: '$reaction-event',
          message: {
            direction: 'incoming',
            type: 'reaction',
            text: '👍',
          },
          rawMatrixEvent: {
            type: 'm.reaction',
            event_id: '$reaction-event',
            content: {
              'm.relates_to': {
                rel_type: 'm.annotation',
                event_id: '$target-event',
                key: '👍',
              },
            },
          },
        }),
      ],
    }),
    logger
  );

  expect(result.ok).toBe(true);
  expect(repository.stored[0]?.message.reaction).toEqual({
    emoji: '👍',
    targetMatrixEventId: '$target-event',
  });
});
```

Run: `pnpm --filter whatsapp-service test -- apps/whatsapp-service/src/__tests__/usecases/ingestPrivateWhatsAppEvents.test.ts -t "normalizes Matrix reaction target metadata"`

Expected: FAIL because `message.reaction` does not exist yet.

- [ ] **Step 2: Add domain input/output types**

In `apps/whatsapp-service/src/domain/whatsapp/models/PrivateWhatsApp.ts`, add:

```ts
export interface PrivateWhatsAppReactionInfo {
  emoji: string;
  targetMatrixEventId: string;
  targetMessageId: string;
}

export interface PrivateWhatsAppReactionInput {
  emoji: string;
  targetMatrixEventId: string;
}

export interface PrivateWhatsAppReactionSummary {
  id: string;
  emoji: string;
  senderKey?: string;
  senderDisplayName?: string;
  senderPhoneNumber?: string;
  direction: PrivateWhatsAppMessageDirection;
  eventTimestamp: string;
}
```

Add `reaction?: PrivateWhatsAppReactionInput` to `PrivateWhatsAppMessageInput` and add `reaction?: PrivateWhatsAppReactionInfo; reactions?: PrivateWhatsAppReactionSummary[]` to `PrivateWhatsAppMessage`.

- [ ] **Step 3: Parse reaction metadata**

In `ingestPrivateWhatsAppEvents.ts`, extend `IngestPrivateWhatsAppEventInput['message']` with:

```ts
reaction?: {
  emoji: string;
  targetMatrixEventId: string;
};
```

Add a helper:

```ts
function parseReaction(rawEvent: Record<string, unknown>, rawMessage: Record<string, unknown>): IngestPrivateWhatsAppEventInput['message']['reaction'] | undefined {
  const explicitReaction = rawMessage['reaction'];
  if (isRecord(explicitReaction)) {
    const emoji = readOptionalString(explicitReaction, 'emoji');
    const targetMatrixEventId = readOptionalString(explicitReaction, 'targetMatrixEventId');
    if (typeof emoji === 'string' && emoji.trim() !== '' && typeof targetMatrixEventId === 'string' && targetMatrixEventId.trim() !== '') {
      return { emoji, targetMatrixEventId };
    }
  }

  const rawMatrixEvent = rawEvent['rawMatrixEvent'];
  if (!isRecord(rawMatrixEvent)) return undefined;
  const content = rawMatrixEvent['content'];
  if (!isRecord(content)) return undefined;
  const relatesTo = content['m.relates_to'];
  if (!isRecord(relatesTo)) return undefined;
  const relType = readOptionalString(relatesTo, 'rel_type');
  const targetMatrixEventId = readOptionalString(relatesTo, 'event_id');
  const key = readOptionalString(relatesTo, 'key');
  if (relType !== 'm.annotation' || typeof targetMatrixEventId !== 'string' || typeof key !== 'string' || key.trim() === '') {
    return undefined;
  }
  return { emoji: key, targetMatrixEventId };
}
```

Call it from `parseMessage()` after text/media parsing, and copy the result to `message.reaction` only when present.

- [ ] **Step 4: Pass reaction metadata into storage**

In `toStoreInput()`, after copying `event.message.media`, add:

```ts
if (event.message.reaction !== undefined) {
  storeInput.message.reaction = event.message.reaction;
}
```

- [ ] **Step 5: Verify ingest test passes**

Run: `pnpm --filter whatsapp-service test -- apps/whatsapp-service/src/__tests__/usecases/ingestPrivateWhatsAppEvents.test.ts -t "normalizes Matrix reaction target metadata"`

Expected: PASS.

## Task 2: Store and Query Reaction Summaries

**Files:**
- Modify: `apps/whatsapp-service/src/domain/whatsapp/ports/privateWhatsAppRepository.ts`
- Modify: `apps/whatsapp-service/src/infra/firestore/privateWhatsAppRepository.ts`
- Modify: `apps/whatsapp-service/src/__tests__/fakes.ts`
- Test: `apps/whatsapp-service/src/__tests__/infra/privateWhatsAppRepository.test.ts`
- Create: `migrations/119_private-whatsapp-reaction-target-index.mjs`
- Create: `migrations/__tests__/119-private-whatsapp-reaction-target-index.test.ts`

**Interfaces:**
- Consumes: stored `PrivateWhatsAppMessage.reaction.targetMessageId`.
- Produces: `findReactionsForMessageIds({ sourceAccountId, chatId, targetMessageIds })`.

- [ ] **Step 1: Add repository failing test**

Add a test that stores a target text message and two reaction messages, then calls the new repository method:

```ts
it('finds private WhatsApp reactions for target message ids without exposing Matrix ids', async () => {
  const target = createStoreInput({
    message: {
      ...createStoreInput().message,
      matrixEventId: '$target-event',
      text: 'original post',
    },
  });
  const targetResult = await repository.storeIncomingMessage(target);
  expect(targetResult.ok).toBe(true);
  if (!targetResult.ok) throw new Error('target store failed');

  const reactionResult = await repository.storeIncomingMessage(
    createStoreInput({
      message: {
        ...createStoreInput().message,
        matrixEventId: '$reaction-event',
        direction: 'incoming',
        type: 'reaction',
        text: '👍',
        reaction: {
          emoji: '👍',
          targetMatrixEventId: '$target-event',
        },
      },
    })
  );
  expect(reactionResult.ok).toBe(true);

  const reactions = await repository.findReactionsForMessageIds({
    sourceAccountId: target.sourceAccountId,
    chatId: targetResult.value.chatId,
    targetMessageIds: [targetResult.value.messageId],
  });

  expect(reactions.ok).toBe(true);
  if (!reactions.ok) throw new Error('reaction query failed');
  expect(reactions.value.reactionsByMessageId[targetResult.value.messageId]).toMatchObject([
    {
      emoji: '👍',
      senderDisplayName: 'Alice',
      direction: 'incoming',
    },
  ]);
  expect(JSON.stringify(reactions.value)).not.toContain('$target-event');
});
```

Run: `pnpm --filter whatsapp-service test -- apps/whatsapp-service/src/__tests__/infra/privateWhatsAppRepository.test.ts -t "finds private WhatsApp reactions"`

Expected: FAIL because the repository method and stored `targetMessageId` are missing.

- [ ] **Step 2: Add repository port contract**

In `PrivateWhatsApp.ts`, add:

```ts
export interface PrivateWhatsAppReactionQueryInput {
  sourceAccountId: string;
  chatId?: string;
  targetMessageIds: string[];
}

export interface PrivateWhatsAppReactionQueryResult {
  reactionsByMessageId: Record<string, PrivateWhatsAppReactionSummary[]>;
}
```

In `privateWhatsAppRepository.ts`, add:

```ts
findReactionsForMessageIds(
  input: PrivateWhatsAppReactionQueryInput
): Promise<Result<PrivateWhatsAppReactionQueryResult, WhatsAppError>>;
```

Update test fakes to return `{ reactionsByMessageId: {} }`.

- [ ] **Step 3: Store deterministic target ids**

In `buildMessage()` inside `apps/whatsapp-service/src/infra/firestore/privateWhatsAppRepository.ts`, when `input.message.reaction` exists, set:

```ts
reaction: {
  emoji: input.message.reaction.emoji,
  targetMatrixEventId: input.message.reaction.targetMatrixEventId,
  targetMessageId: createPrivateWhatsAppMessageId(input.sourceAccountId, input.message.reaction.targetMatrixEventId),
}
```

Keep the raw target Matrix id only in Firestore/private domain. Public projection must strip it in Task 3.

- [ ] **Step 4: Implement reaction target query**

Add helper chunks of 30 ids to satisfy Firestore `in` query limits:

```ts
function chunkMessageIds(ids: string[]): string[][] {
  const chunks: string[][] = [];
  for (let index = 0; index < ids.length; index += 30) {
    chunks.push(ids.slice(index, index + 30));
  }
  return chunks;
}
```

Implement `findReactionsForMessageIds()` using:

```ts
let query: Query = getFirestore()
  .collection(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)
  .where('sourceAccountId', '==', input.sourceAccountId)
  .where('messageType', '==', 'reaction')
  .where('reaction.targetMessageId', 'in', chunk)
  .orderBy('eventTimestamp', 'asc')
  .orderBy(FieldPath.documentId(), 'asc');

if (input.chatId !== undefined) {
  query = query.where('chatId', '==', input.chatId);
}
```

Project each reaction with `toReactionSummary(message)` and group by `message.reaction.targetMessageId`.

- [ ] **Step 5: Add Firestore index migration**

Create `migrations/119_private-whatsapp-reaction-target-index.mjs`:

```js
/**
 * Migration 119: Private WhatsApp reaction target index.
 *
 * Required by whatsapp-service private message reads to load reactions by target message id.
 */

export const metadata = {
  id: '119',
  name: 'private-whatsapp-reaction-target-index',
  description: 'Private WhatsApp reaction lookup by target message id',
  createdAt: '2026-07-03',
};

export const indexes = [
  {
    collectionGroup: 'whatsapp_private_messages',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'sourceAccountId', order: 'ASCENDING' },
      { fieldPath: 'chatId', order: 'ASCENDING' },
      { fieldPath: 'messageType', order: 'ASCENDING' },
      { fieldPath: 'reaction.targetMessageId', order: 'ASCENDING' },
      { fieldPath: 'eventTimestamp', order: 'ASCENDING' },
      { fieldPath: '__name__', order: 'ASCENDING' },
    ],
  },
  {
    collectionGroup: 'whatsapp_private_messages',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'sourceAccountId', order: 'ASCENDING' },
      { fieldPath: 'messageType', order: 'ASCENDING' },
      { fieldPath: 'reaction.targetMessageId', order: 'ASCENDING' },
      { fieldPath: 'eventTimestamp', order: 'ASCENDING' },
      { fieldPath: '__name__', order: 'ASCENDING' },
    ],
  },
];

export async function up(context) {
  console.log('  Deploying private WhatsApp reaction target indexes...');
  await context.deployIndexes();
}
```

Add a migration test matching the existing `117` and `118` index tests.

- [ ] **Step 6: Verify repository and migration tests**

Run:

```bash
pnpm --filter whatsapp-service test -- apps/whatsapp-service/src/__tests__/infra/privateWhatsAppRepository.test.ts -t "finds private WhatsApp reactions"
pnpm --filter @intexuraos/migrations test -- migrations/__tests__/119-private-whatsapp-reaction-target-index.test.ts
```

Expected: PASS.

## Task 3: Enrich Private Read Responses

**Files:**
- Modify: `apps/whatsapp-service/src/routes/privateReadRoutes.ts`
- Test: `apps/whatsapp-service/src/__tests__/privateSyncRoutes.test.ts`

**Interfaces:**
- Consumes: `PrivateWhatsAppRepository.findMessages()` and `findReactionsForMessageIds()`.
- Produces: public messages with inline `reactions` and no Matrix identifiers.

- [ ] **Step 1: Add route failing test**

Add a public chat-message route test that ingests:

1. a target text message,
2. an attached reaction to that target, and
3. a second text message.

Assert the response for `GET /private/chats/:chatId/messages` has the target row with:

```ts
expect(body.data.messages[1]).toMatchObject({
  text: 'original post',
  reactions: [
    {
      emoji: '👍',
      senderDisplayName: 'Alice',
      direction: 'incoming',
    },
  ],
});
expect(body.data.messages.some((message: { messageType: string }) => message.messageType === 'reaction')).toBe(false);
expect(JSON.stringify(body.data)).not.toContain('targetMatrixEventId');
expect(JSON.stringify(body.data)).not.toContain('matrixEventId');
```

Run: `pnpm --filter whatsapp-service test -- apps/whatsapp-service/src/__tests__/privateSyncRoutes.test.ts -t "inline reactions"`

Expected: FAIL because route responses do not enrich reactions.

- [ ] **Step 2: Add public projection types**

In `privateReadRoutes.ts`, add:

```ts
interface PublicPrivateWhatsAppReaction {
  id: string;
  emoji: string;
  senderKey?: string;
  senderDisplayName?: string;
  senderPhoneNumber?: string;
  direction: PrivateWhatsAppMessage['direction'];
  eventTimestamp: string;
}
```

Extend `PublicPrivateWhatsAppMessage` with:

```ts
reaction?: {
  emoji: string;
  targetMessageId: string;
};
reactions?: PublicPrivateWhatsAppReaction[];
```

- [ ] **Step 3: Hydrate inline reactions**

Add a route helper:

```ts
async function hydrateInlineReactions(input: {
  sourceAccountId: string;
  chatId?: string;
  messages: PrivateWhatsAppMessage[];
}): Promise<Result<PrivateWhatsAppMessage[], WhatsAppError>> {
  const targetMessageIds = input.messages
    .filter((message) => message.messageType !== 'reaction')
    .map((message) => message.id);
  if (targetMessageIds.length === 0) return ok(input.messages);

  const reactionsResult = await getServices().privateWhatsAppRepository.findReactionsForMessageIds({
    sourceAccountId: input.sourceAccountId,
    ...(input.chatId !== undefined ? { chatId: input.chatId } : {}),
    targetMessageIds,
  });
  if (!reactionsResult.ok) return err(reactionsResult.error);

  const targetIds = new Set(targetMessageIds);
  return ok(
    input.messages
      .filter((message) => message.messageType !== 'reaction' || !targetIds.has(message.reaction?.targetMessageId ?? ''))
      .map((message) => ({
        ...message,
        reactions: reactionsResult.value.reactionsByMessageId[message.id],
      }))
  );
}
```

Import `ok`, `err`, and `Result` from `@intexuraos/common-core` if not already present.

- [ ] **Step 4: Use hydration in both private message routes**

In `GET /private/chats/:chatId/messages`, call the helper with `chatId: request.params.chatId` before `toPublicMessage`.

In `GET /private/messages`, call the helper without `chatId`; the target ids from the page still constrain the reaction lookup.

If hydration fails, return `reply.fail('INTERNAL_ERROR', result.error.message)`.

- [ ] **Step 5: Strip private reaction internals in public projection**

Update `toPublicMessage()`:

```ts
reaction:
  message.reaction === undefined
    ? undefined
    : {
        emoji: message.reaction.emoji,
        targetMessageId: message.reaction.targetMessageId,
      },
reactions: message.reactions?.map(toPublicReaction),
```

Add `toPublicReaction()` so summaries never include `targetMatrixEventId`.

- [ ] **Step 6: Verify route tests**

Run: `pnpm --filter whatsapp-service test -- apps/whatsapp-service/src/__tests__/privateSyncRoutes.test.ts -t "inline reactions"`

Expected: PASS.

## Task 4: Render Reactions in the Private WhatsApp Log

**Files:**
- Modify: `apps/web/src/types/index.ts`
- Modify: `apps/web/src/pages/PrivateWhatsAppLogPage.tsx`
- Test: `apps/web/src/pages/__tests__/PrivateWhatsAppLogPage.test.tsx`

**Interfaces:**
- Consumes: `PrivateWhatsAppMessage.reactions`.
- Produces: reaction chips below the target message body.

- [ ] **Step 1: Add UI failing test**

In `PrivateWhatsAppLogPage.test.tsx`, add a fixture message with:

```ts
reactions: [
  {
    id: 'reaction-1',
    emoji: '👍',
    senderDisplayName: 'Alice',
    direction: 'incoming',
    eventTimestamp: '2026-07-03T10:05:00.000Z',
  },
],
```

Assert:

```ts
expect(screen.getByText('👍')).toBeInTheDocument();
expect(screen.getByText('Alice')).toBeInTheDocument();
```

Run: `pnpm --filter web test -- apps/web/src/pages/__tests__/PrivateWhatsAppLogPage.test.tsx -t "renders inline reactions"`

Expected: FAIL because the page ignores `reactions`.

- [ ] **Step 2: Add web types**

In `apps/web/src/types/index.ts`, add:

```ts
export interface PrivateWhatsAppReaction {
  id: string;
  emoji: string;
  senderKey?: string;
  senderDisplayName?: string;
  senderPhoneNumber?: string;
  direction: 'incoming' | 'outgoing';
  eventTimestamp: string;
}
```

Add to `PrivateWhatsAppMessage`:

```ts
reaction?: {
  emoji: string;
  targetMessageId: string;
};
reactions?: PrivateWhatsAppReaction[];
```

- [ ] **Step 3: Render inline reaction chips**

In `PrivateWhatsAppLogPage.tsx`, add:

```tsx
function getReactionSenderLabel(reaction: PrivateWhatsAppReaction): string {
  if (reaction.direction === 'outgoing') return 'You';
  return reaction.senderDisplayName ?? reaction.senderPhoneNumber ?? reaction.senderKey ?? 'Unknown sender';
}

function MessageReactions({ message }: { message: PrivateWhatsAppMessage }): React.JSX.Element | null {
  const reactions = message.reactions ?? [];
  if (reactions.length === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {reactions.map((reaction) => (
        <span
          key={reaction.id}
          className="inline-flex max-w-full items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          title={`${getReactionSenderLabel(reaction)} reacted at ${formatDateTimeCompact(reaction.eventTimestamp)}`}
        >
          <span aria-hidden="true">{reaction.emoji}</span>
          <span className="truncate">{getReactionSenderLabel(reaction)}</span>
        </span>
      ))}
    </div>
  );
}
```

Render `<MessageReactions message={message} />` directly after `<MessageBody message={message} />` inside each message bubble.

- [ ] **Step 4: Add standalone reaction fallback**

In `MessageBody()`, before generic media fallback, add:

```tsx
if (message.messageType === 'reaction' && message.reaction !== undefined) {
  return (
    <p className="text-sm text-slate-600 dark:text-slate-300">
      Reacted {message.reaction.emoji} to an earlier message
    </p>
  );
}
```

This covers pagination cases where the reaction row is visible but the target message is not in the current response page.

- [ ] **Step 5: Verify UI test**

Run: `pnpm --filter web test -- apps/web/src/pages/__tests__/PrivateWhatsAppLogPage.test.tsx -t "renders inline reactions"`

Expected: PASS.

## Task 5: Fold Reactions into Conversation Assistant Transcripts

**Files:**
- Modify: `apps/whatsapp-service/src/domain/conversation-assistant/transcriptFormatting.ts`
- Test: `apps/whatsapp-service/src/__tests__/domain/conversation-assistant/transcriptFormatting.test.ts`

**Interfaces:**
- Consumes: `PrivateWhatsAppMessage.reaction` and target messages in the selected private context range.
- Produces: transcript lines that include reaction summaries on the target message, while attached reaction rows are omitted as standalone context messages.

- [ ] **Step 1: Add transcript failing test**

Add:

```ts
it('folds private WhatsApp reactions into the target transcript message', () => {
  const target = createPrivateMessage({
    id: 'target-message',
    matrixEventId: '$target',
    text: 'See you at five',
    eventTimestamp: '2026-07-03T10:00:00.000Z',
  });
  const reaction = createPrivateMessage({
    id: 'reaction-message',
    matrixEventId: '$reaction',
    messageType: 'reaction',
    text: '👍',
    eventTimestamp: '2026-07-03T10:05:00.000Z',
    reaction: {
      emoji: '👍',
      targetMatrixEventId: '$target',
      targetMessageId: 'target-message',
    },
  });

  const context = projectPrivateConversationContext({
    chat: createDirectChat(),
    range: { from: '2026-07-03T00:00:00.000Z', to: '2026-07-04T00:00:00.000Z' },
    messages: [target, reaction],
  });

  expect(context.messages).toHaveLength(1);
  expect(buildPrivateConversationTranscriptText(context.messages)).toContain(
    '[3 July] Alice: See you at five\n  Reactions: 👍 Alice'
  );
});
```

Run: `pnpm --filter whatsapp-service test -- apps/whatsapp-service/src/__tests__/domain/conversation-assistant/transcriptFormatting.test.ts -t "folds private WhatsApp reactions"`

Expected: FAIL because reactions are standalone context messages today.

- [ ] **Step 2: Add reactions to context messages**

Extend `PrivateConversationContextMessage` in `transcriptFormatting.ts`:

```ts
reactions?: PrivateWhatsAppReactionSummary[];
```

Before the projection loop, build a map of reaction summaries:

```ts
const reactionsByTarget = new Map<string, PrivateWhatsAppReactionSummary[]>();
const attachedReactionIds = new Set<string>();
for (const message of input.messages) {
  if (message.messageType !== 'reaction' || message.reaction === undefined) continue;
  const target = input.messages.find((candidate) => candidate.id === message.reaction?.targetMessageId);
  if (target === undefined) continue;
  attachedReactionIds.add(message.id);
  const summaries = reactionsByTarget.get(target.id) ?? [];
  summaries.push({
    id: message.id,
    emoji: message.reaction.emoji,
    senderKey: message.senderKey,
    senderDisplayName: message.senderDisplayName,
    senderPhoneNumber: message.senderPhoneNumber,
    direction: message.direction,
    eventTimestamp: message.eventTimestamp,
  });
  reactionsByTarget.set(target.id, summaries);
}
```

Skip messages in `attachedReactionIds` during the main projection loop. Pass `reactionsByTarget.get(message.id)` into `toContextMessage()`.

- [ ] **Step 3: Render transcript reactions below the target line**

Update `buildPrivateConversationTranscriptText()`:

```ts
function formatReactionSummary(reaction: PrivateWhatsAppReactionSummary): string {
  const sender = reaction.direction === 'outgoing'
    ? 'You'
    : firstNonEmpty(reaction.senderDisplayName, reaction.senderPhoneNumber, reaction.senderKey) ?? 'Unknown';
  return `${reaction.emoji} ${sender}`;
}
```

Append a second line only when reactions exist:

```ts
const reactionLine =
  message.reactions === undefined || message.reactions.length === 0
    ? ''
    : `\n  Reactions: ${message.reactions.map(formatReactionSummary).join(', ')}`;
return `[${formatTranscriptDateLabel(message.eventTimestamp)}] ${message.speakerLabel}: ${message.content}${reactionLine}`;
```

- [ ] **Step 4: Verify transcript tests**

Run: `pnpm --filter whatsapp-service test -- apps/whatsapp-service/src/__tests__/domain/conversation-assistant/transcriptFormatting.test.ts -t "folds private WhatsApp reactions"`

Expected: PASS.

## Assistant Message Follow-Up Contract

Public Intex Agent assistant messages use WhatsApp Cloud API `wamid` correlation, not Matrix event ids. The follow-up implementation should be a separate issue with these boundaries:

- `whatsapp-service`: change the current `REACTION_NOT_SUPPORTED` path to resolve `reactionData.messageId` through `messageRepository.findByWaMessageId()` and `outboundMessageRepository.findByWamid()`. If the target is an outbound assistant message for the same user, publish a new internal event `{ type: 'intex.message.reaction', userId, targetWamid, source: 'outbound_assistant_message', emoji, reactedAt, correlationId }`.
- `intex-agent`: add a decoder and session repository event type, for example `assistant_reaction`, keyed by `targetWamid` or by the session event that emitted the assistant reply.
- `apps/web`: render `assistant_reaction` chips on the matching assistant message in `apps/web/src/components/intex-agent/IntexSessionTimeline.tsx`.

This should not block the private WhatsApp inline reaction work because it changes a different message identity system and a different timeline.

## Verification

- `pnpm --filter whatsapp-service test -- apps/whatsapp-service/src/__tests__/usecases/ingestPrivateWhatsAppEvents.test.ts apps/whatsapp-service/src/__tests__/infra/privateWhatsAppRepository.test.ts apps/whatsapp-service/src/__tests__/privateSyncRoutes.test.ts apps/whatsapp-service/src/__tests__/domain/conversation-assistant/transcriptFormatting.test.ts`
- `pnpm --filter web test -- apps/web/src/pages/__tests__/PrivateWhatsAppLogPage.test.tsx`
- `pnpm --filter @intexuraos/migrations test -- migrations/__tests__/119-private-whatsapp-reaction-target-index.test.ts`
- `pnpm run verify:workspace:tracked -- whatsapp-service`
- `pnpm run verify:workspace:tracked -- web`
- `pnpm run ci:tracked`

## Self-Review Notes

- Every private identifier from Matrix remains server-side.
- The private log gets inline display without requiring a historical backfill.
- Conversation Assistant handles private-context reactions by transcript projection, not by changing public assistant turn APIs.
- Public Intex Agent assistant-message reactions are documented as a separate cross-service follow-up because they require a new event contract.
