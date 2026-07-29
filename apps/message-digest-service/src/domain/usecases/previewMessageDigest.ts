import type { MessageDigestSourceMessage } from '@intexuraos/llm-prompts';
import type { MessageDigestSchedule } from '../models/messageDigestDefinition.js';
import type {
  MessageDigestAggregator,
  MessageDigestDeliveryReadiness,
  MessageDigestWhatsAppClient,
  ValidatedMessageDigestSource,
} from '../ports/messageDigestClients.js';
import { previewMessageDigestSchedule as previewCalendarSchedule } from '../schedules/messageDigestSchedule.js';

const SOURCE_PAGE_LIMIT = 200;
const MAX_SOURCE_PAGES = 25;

export interface PreviewMessageDigestInput {
  userId: string;
  correlationId: string;
  source: { chatId: string };
  instructions: {
    templateId: 'fishing_group' | 'direct_sentiment' | 'custom';
    text: string;
  };
  schedule: MessageDigestSchedule;
}

export interface PreviewMessageDigestDependencies {
  whatsappClient: Pick<
    MessageDigestWhatsAppClient,
    'validateSource' | 'getDeliveryReadiness' | 'queryMessages'
  >;
  aggregator: MessageDigestAggregator;
  now?: (() => string) | undefined;
}

export interface MessageDigestPreview {
  status: 'generated' | 'no_activity';
  window: { start: string; end: string; timeZone: string };
  source: { chatType: 'group' | 'direct'; displayName: string };
  deliveryReadiness:
    | { status: 'ready'; maskedPrimaryNumber?: string | undefined }
    | { status: 'mapping_missing' | 'disconnected' | 'delivery_disabled' };
  messageCount: number;
  content: { headline: string; summaryMarkdown: string } | null;
}

export type PreviewMessageDigestResult =
  | { ok: true; preview: MessageDigestPreview }
  | {
      ok: false;
      code:
        | 'INVALID_REQUEST'
        | 'INVALID_SCHEDULE'
        | 'SOURCE_NOT_FOUND'
        | 'SOURCE_UNAVAILABLE'
        | 'SOURCE_CHANGED'
        | 'READINESS_UNAVAILABLE'
        | 'SOURCE_TOO_LARGE'
        | 'LLM_UNAVAILABLE'
        | 'INVALID_AGGREGATE';
    };

export async function previewMessageDigest(
  input: PreviewMessageDigestInput,
  dependencies: PreviewMessageDigestDependencies
): Promise<PreviewMessageDigestResult> {
  const normalized = normalizeInput(input);
  if (normalized === null) return { ok: false, code: 'INVALID_REQUEST' };
  const evaluatedAt = normalizeTimestamp(dependencies.now?.() ?? new Date().toISOString());
  if (evaluatedAt === null) return { ok: false, code: 'INVALID_REQUEST' };
  const schedule = previewCalendarSchedule({
    schedule: normalized.schedule,
    evaluatedAt,
  });
  if (!schedule.ok) return { ok: false, code: 'INVALID_SCHEDULE' };

  const source = await dependencies.whatsappClient.validateSource({
    userId: normalized.userId,
    chatId: normalized.source.chatId,
  });
  if (!source.ok) {
    return {
      ok: false,
      code: source.code === 'not_found' ? 'SOURCE_NOT_FOUND' : 'SOURCE_UNAVAILABLE',
    };
  }

  const readiness = await dependencies.whatsappClient.getDeliveryReadiness(normalized.userId);
  if (!readiness.ok) return { ok: false, code: 'READINESS_UNAVAILABLE' };

  const messages = await readFrozenMessages(
    dependencies.whatsappClient,
    normalized.userId,
    source.value,
    schedule.value.precedingBoundary,
    evaluatedAt
  );
  if (!messages.ok) return messages;

  const aggregated = await dependencies.aggregator.aggregate({
    userId: normalized.userId,
    correlationId: normalized.correlationId,
    chatType: source.value.chatType,
    conversationLabel: source.value.displayName,
    windowStart: schedule.value.precedingBoundary,
    windowEnd: evaluatedAt,
    instructions: normalized.instructions.text,
    continuityMemoryMarkdown: '',
    previousSummaries: [],
    messages: messages.value,
  });
  if (!aggregated.ok) return aggregated;
  if (
    (aggregated.kind === 'empty' && aggregated.aggregate !== null) ||
    (aggregated.kind === 'aggregate' && aggregated.aggregate === null)
  ) {
    return { ok: false, code: 'INVALID_AGGREGATE' };
  }

  return {
    ok: true,
    preview: {
      status: aggregated.kind === 'empty' ? 'no_activity' : 'generated',
      window: {
        start: schedule.value.precedingBoundary,
        end: evaluatedAt,
        timeZone: schedule.value.timeZone,
      },
      source: {
        chatType: source.value.chatType,
        displayName: source.value.displayName,
      },
      deliveryReadiness: projectReadiness(readiness.value),
      messageCount: messages.value.length,
      content:
        aggregated.aggregate === null
          ? null
          : {
              headline: aggregated.aggregate.headline,
              summaryMarkdown: aggregated.aggregate.summaryMarkdown,
            },
    },
  };
}

async function readFrozenMessages(
  whatsappClient: Pick<MessageDigestWhatsAppClient, 'queryMessages'>,
  userId: string,
  source: ValidatedMessageDigestSource,
  windowStart: string,
  windowEnd: string
): Promise<
  | { ok: true; value: MessageDigestSourceMessage[] }
  | {
      ok: false;
      code: 'SOURCE_NOT_FOUND' | 'SOURCE_UNAVAILABLE' | 'SOURCE_CHANGED' | 'SOURCE_TOO_LARGE';
    }
> {
  const messages: MessageDigestSourceMessage[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  let frozenRevision: string | undefined;
  let frozenHighWatermark: string | null | undefined;

  for (let pageNumber = 0; pageNumber < MAX_SOURCE_PAGES; pageNumber += 1) {
    const page = await whatsappClient.queryMessages({
      userId,
      sourceAccountId: source.sourceAccountId,
      generationId: source.generationId,
      chatId: source.chatId,
      chatType: source.chatType,
      windowStart,
      windowEnd,
      limit: SOURCE_PAGE_LIMIT,
      ...(cursor === undefined ? {} : { cursor }),
    });
    if (!page.ok) {
      if (page.code === 'source_changed') return { ok: false, code: 'SOURCE_CHANGED' };
      if (page.code === 'not_found') return { ok: false, code: 'SOURCE_NOT_FOUND' };
      return { ok: false, code: 'SOURCE_UNAVAILABLE' };
    }
    if (frozenRevision === undefined) {
      frozenRevision = page.value.sourceRevision;
      frozenHighWatermark = page.value.highWatermark;
    } else if (
      page.value.sourceRevision !== frozenRevision ||
      page.value.highWatermark !== frozenHighWatermark
    ) {
      return { ok: false, code: 'SOURCE_CHANGED' };
    }
    messages.push(...page.value.messages);
    if (page.value.nextCursor === null) return { ok: true, value: messages };
    if (seenCursors.has(page.value.nextCursor)) return { ok: false, code: 'SOURCE_CHANGED' };
    seenCursors.add(page.value.nextCursor);
    cursor = page.value.nextCursor;
  }
  return { ok: false, code: 'SOURCE_TOO_LARGE' };
}

function projectReadiness(
  readiness: MessageDigestDeliveryReadiness
): MessageDigestPreview['deliveryReadiness'] {
  if (readiness.status !== 'ready') return { status: readiness.status };
  return {
    status: 'ready',
    ...(readiness.maskedPrimaryNumber === undefined
      ? {}
      : { maskedPrimaryNumber: readiness.maskedPrimaryNumber }),
  };
}

function normalizeInput(input: PreviewMessageDigestInput): PreviewMessageDigestInput | null {
  const userId = input.userId.trim();
  const correlationId = input.correlationId.trim();
  const chatId = input.source.chatId.trim();
  const instructions = input.instructions.text.trim();
  if (
    userId === '' ||
    userId.length > 256 ||
    correlationId === '' ||
    correlationId.length > 256 ||
    chatId === '' ||
    chatId.length > 4_096 ||
    instructions.length < 20 ||
    instructions.length > 4_000 ||
    !isInstructionTemplate(input.instructions.templateId)
  ) {
    return null;
  }
  return {
    userId,
    correlationId,
    source: { chatId },
    instructions: { templateId: input.instructions.templateId, text: instructions },
    schedule: input.schedule,
  };
}

function isInstructionTemplate(value: string): boolean {
  return value === 'fishing_group' || value === 'direct_sentiment' || value === 'custom';
}

function normalizeTimestamp(value: string): string | null {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}
