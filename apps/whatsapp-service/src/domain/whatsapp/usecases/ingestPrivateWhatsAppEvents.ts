import { err, ok, type Result } from '@intexuraos/common-core';
import type { WhatsAppError } from '../models/error.js';
import type {
  PrivateWhatsAppChatType,
  PrivateWhatsAppDeliveryMode,
  PrivateWhatsAppIngestEventResult,
  PrivateWhatsAppIngestResult,
  PrivateWhatsAppMessageType,
  StorePrivateWhatsAppMessageInput,
} from '../models/PrivateWhatsApp.js';
import type { PrivateWhatsAppRepository } from '../ports/privateWhatsAppRepository.js';
import type { Logger } from '../utils/logger.js';

export interface IngestPrivateWhatsAppEventsInput {
  sourceAccountId: string;
  userId: string;
  deliveryMode: PrivateWhatsAppDeliveryMode;
  events: unknown[];
}

export interface IngestPrivateWhatsAppEventInput {
  matrixRoomId: string;
  matrixEventId: string;
  matrixSenderId: string;
  eventTimestamp: string;
  receivedAt?: string;
  chat: {
    type: string;
    displayName?: string;
    avatarMxcUri?: string;
  };
  sender?: {
    displayName?: string;
    phoneNumber?: string;
  };
  message: {
    direction: string;
    type: string;
    text?: string;
    media?: {
      mxcUri: string;
      mimeType?: string;
      fileName?: string;
      sizeBytes?: number;
      sha256?: string;
    };
  };
  rawMatrixEvent: unknown;
}

export interface IngestPrivateWhatsAppEventsDeps {
  privateWhatsAppRepository: PrivateWhatsAppRepository;
}

type ParseEventResult =
  | { ok: true; event: IngestPrivateWhatsAppEventInput }
  | RejectedEvent;
type ParseMessageResult =
  | { ok: true; message: IngestPrivateWhatsAppEventInput['message'] }
  | RejectedEvent;
type ParseMediaResult =
  | { ok: true; media?: IngestPrivateWhatsAppEventInput['message']['media'] }
  | RejectedEvent;

interface RejectedEvent {
  ok: false;
  matrixEventId: string;
  reason: string;
}

const MESSAGE_TYPES = new Set<PrivateWhatsAppMessageType>([
  'text',
  'image',
  'audio',
  'video',
  'file',
  'sticker',
  'reaction',
  'redaction',
  'unknown',
]);

const CHAT_TYPES = new Set<PrivateWhatsAppChatType>(['direct', 'group', 'unknown']);
const PRIVATE_WHATSAPP_EVENT_TIME_ZONE = 'Europe/Warsaw';

export class IngestPrivateWhatsAppEventsUseCase {
  constructor(private readonly deps: IngestPrivateWhatsAppEventsDeps) {}

  async execute(
    input: IngestPrivateWhatsAppEventsInput,
    logger: Logger
  ): Promise<Result<PrivateWhatsAppIngestResult, WhatsAppError>> {
    const messages: PrivateWhatsAppIngestEventResult[] = [];

    for (const rawEvent of input.events) {
      const parsedEvent = parseEvent(rawEvent);
      if (!parsedEvent.ok) {
        messages.push({
          matrixEventId: parsedEvent.matrixEventId,
          outcome: 'rejected',
          reason: parsedEvent.reason,
        });
        continue;
      }

      const event = parsedEvent.event;
      const storeInput = toStoreInput(input, event);
      const storeResult = await this.deps.privateWhatsAppRepository.storeIncomingMessage(storeInput);
      if (!storeResult.ok) {
        logger.error(
          {
            matrixEventId: event.matrixEventId,
            sourceAccountId: input.sourceAccountId,
            error: storeResult.error,
          },
          'Failed to store private WhatsApp event'
        );
        return err(storeResult.error);
      }

      const outcome = storeResult.value;
      const result: PrivateWhatsAppIngestEventResult = {
        matrixEventId: outcome.matrixEventId,
        outcome: outcome.outcome,
        chatId: outcome.chatId,
        messageId: outcome.messageId,
      };
      messages.push(result);
    }

    const summary = summarize(messages);
    logger.info(
      {
        sourceAccountId: input.sourceAccountId,
        deliveryMode: input.deliveryMode,
        accepted: summary.accepted,
        duplicates: summary.duplicates,
        rejected: summary.rejected,
      },
      'Private WhatsApp ingest completed'
    );
    return ok(summary);
  }
}

function parseEvent(rawEvent: unknown): ParseEventResult {
  if (!isRecord(rawEvent)) {
    return rejectEvent('<unknown>', 'invalid_event');
  }

  const matrixEventId = readRequiredString(rawEvent, 'matrixEventId');
  if (matrixEventId === null) return rejectEvent('<unknown>', 'missing_matrix_event_id');

  const matrixRoomId = readRequiredString(rawEvent, 'matrixRoomId');
  if (matrixRoomId === null) return rejectEvent(matrixEventId, 'missing_matrix_room_id');

  const matrixSenderId = readRequiredString(rawEvent, 'matrixSenderId');
  if (matrixSenderId === null) return rejectEvent(matrixEventId, 'missing_matrix_sender_id');

  const eventTimestamp = readRequiredString(rawEvent, 'eventTimestamp');
  if (eventTimestamp === null) return rejectEvent(matrixEventId, 'missing_event_timestamp');
  if (Number.isNaN(Date.parse(eventTimestamp))) {
    return rejectEvent(matrixEventId, 'invalid_event_timestamp');
  }

  const receivedAt = readOptionalString(rawEvent, 'receivedAt');
  if (receivedAt === null || (receivedAt !== undefined && Number.isNaN(Date.parse(receivedAt)))) {
    return rejectEvent(matrixEventId, 'invalid_received_at');
  }

  const message = parseMessage(rawEvent, matrixEventId);
  if (!message.ok) return message;

  const chat = parseChat(rawEvent);
  const event: IngestPrivateWhatsAppEventInput = {
    matrixRoomId,
    matrixEventId,
    matrixSenderId,
    eventTimestamp,
    chat,
    message: message.message,
    rawMatrixEvent: rawEvent['rawMatrixEvent'] ?? rawEvent,
  };

  if (receivedAt !== undefined) {
    event.receivedAt = receivedAt;
  }

  const sender = parseSender(rawEvent);
  if (sender !== undefined) {
    event.sender = sender;
  }

  return { ok: true, event };
}

function parseChat(rawEvent: Record<string, unknown>): IngestPrivateWhatsAppEventInput['chat'] {
  const rawChat = rawEvent['chat'];
  if (!isRecord(rawChat)) {
    return { type: 'unknown' };
  }

  const chat: IngestPrivateWhatsAppEventInput['chat'] = {
    type: readOptionalString(rawChat, 'type') ?? 'unknown',
  };
  const displayName = readOptionalString(rawChat, 'displayName');
  if (typeof displayName === 'string') {
    chat.displayName = displayName;
  }
  const avatarMxcUri = readOptionalString(rawChat, 'avatarMxcUri');
  if (typeof avatarMxcUri === 'string') {
    chat.avatarMxcUri = avatarMxcUri;
  }
  return chat;
}

function parseSender(
  rawEvent: Record<string, unknown>
): IngestPrivateWhatsAppEventInput['sender'] | undefined {
  const rawSender = rawEvent['sender'];
  if (!isRecord(rawSender)) {
    return undefined;
  }

  const sender: NonNullable<IngestPrivateWhatsAppEventInput['sender']> = {};
  const displayName = readOptionalString(rawSender, 'displayName');
  if (typeof displayName === 'string') {
    sender.displayName = displayName;
  }
  const phoneNumber = readOptionalString(rawSender, 'phoneNumber');
  if (typeof phoneNumber === 'string') {
    sender.phoneNumber = phoneNumber;
  }
  return sender;
}

function parseMessage(
  rawEvent: Record<string, unknown>,
  matrixEventId: string
): ParseMessageResult {
  const rawMessage = rawEvent['message'];
  if (!isRecord(rawMessage)) {
    return rejectEvent(matrixEventId, 'missing_message');
  }

  const direction = readRequiredString(rawMessage, 'direction');
  if (direction !== 'incoming') {
    return rejectEvent(matrixEventId, 'unsupported_direction');
  }

  const message: IngestPrivateWhatsAppEventInput['message'] = {
    direction,
    type: readOptionalString(rawMessage, 'type') ?? 'unknown',
  };
  const text = readOptionalString(rawMessage, 'text');
  if (typeof text === 'string') {
    message.text = text;
  }

  const media = parseMedia(rawMessage, matrixEventId);
  if (!media.ok) return media;
  if (media.media !== undefined) {
    message.media = media.media;
  }

  return { ok: true, message };
}

function parseMedia(
  rawMessage: Record<string, unknown>,
  matrixEventId: string
): ParseMediaResult {
  const rawMedia = rawMessage['media'];
  if (rawMedia === undefined) {
    return { ok: true };
  }
  if (!isRecord(rawMedia)) {
    return rejectEvent(matrixEventId, 'missing_media_mxc_uri');
  }

  const mxcUri = readRequiredString(rawMedia, 'mxcUri');
  if (mxcUri === null) {
    return rejectEvent(matrixEventId, 'missing_media_mxc_uri');
  }

  const media: NonNullable<IngestPrivateWhatsAppEventInput['message']['media']> = { mxcUri };
  const mimeType = readOptionalString(rawMedia, 'mimeType');
  if (typeof mimeType === 'string') {
    media.mimeType = mimeType;
  }
  const fileName = readOptionalString(rawMedia, 'fileName');
  if (typeof fileName === 'string') {
    media.fileName = fileName;
  }
  const sizeBytes = rawMedia['sizeBytes'];
  if (typeof sizeBytes === 'number' && Number.isFinite(sizeBytes)) {
    media.sizeBytes = sizeBytes;
  }
  const sha256 = readOptionalString(rawMedia, 'sha256');
  if (typeof sha256 === 'string') {
    media.sha256 = sha256;
  }
  return { ok: true, media };
}

function rejectEvent(matrixEventId: string, reason: string): RejectedEvent {
  return { ok: false, matrixEventId, reason };
}

function readRequiredString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }
  return value;
}

function readOptionalString(
  record: Record<string, unknown>,
  key: string
): string | undefined | null {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    return null;
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toStoreInput(
  input: IngestPrivateWhatsAppEventsInput,
  event: IngestPrivateWhatsAppEventInput
): StorePrivateWhatsAppMessageInput {
  const normalizedPhoneNumber = normalizeSenderPhoneNumber(event.sender?.phoneNumber);
  const senderKey =
    normalizedPhoneNumber === undefined
      ? `matrix:${event.matrixSenderId}`
      : `phone:+${normalizedPhoneNumber}`;
  const storeInput: StorePrivateWhatsAppMessageInput = {
    sourceAccountId: input.sourceAccountId,
    userId: input.userId,
    deliveryMode: input.deliveryMode,
    receivedAt: event.receivedAt ?? new Date().toISOString(),
    chat: {
      matrixRoomId: event.matrixRoomId,
      type: normalizeChatType(event.chat.type),
    },
    message: {
      matrixRoomId: event.matrixRoomId,
      matrixEventId: event.matrixEventId,
      matrixSenderId: event.matrixSenderId,
      direction: 'incoming',
      type: normalizeMessageType(event.message.type),
      eventTimestamp: event.eventTimestamp,
      eventDayKey: toWarsawDayKey(event.eventTimestamp),
      eventTimeZone: PRIVATE_WHATSAPP_EVENT_TIME_ZONE,
      senderKey,
      rawMatrixEvent: event.rawMatrixEvent,
    },
  };

  if (event.chat.displayName !== undefined) {
    storeInput.chat.displayName = event.chat.displayName;
  }
  if (event.chat.avatarMxcUri !== undefined) {
    storeInput.chat.avatarMxcUri = event.chat.avatarMxcUri;
  }
  if (event.sender?.displayName !== undefined) {
    storeInput.message.senderDisplayName = event.sender.displayName;
  }
  if (event.sender?.phoneNumber !== undefined) {
    storeInput.message.senderPhoneNumber = event.sender.phoneNumber;
  }
  if (normalizedPhoneNumber !== undefined) {
    storeInput.message.senderPhoneNumberNormalized = normalizedPhoneNumber;
  }
  if (event.message.text !== undefined) {
    storeInput.message.text = event.message.text;
  }
  if (event.message.media !== undefined) {
    storeInput.message.media = event.message.media;
  }

  return storeInput;
}

function normalizeSenderPhoneNumber(phoneNumber: string | undefined): string | undefined {
  if (phoneNumber === undefined) {
    return undefined;
  }
  const normalized = phoneNumber.replace(/\D/g, '');
  return normalized.length === 0 ? undefined : normalized;
}

function toWarsawDayKey(timestamp: string): string {
  const date = new Date(timestamp);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: PRIVATE_WHATSAPP_EVENT_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;

  /* v8 ignore start -- upstream: Intl.DateTimeFormat requests year/month/day and always include those parts; fallback guard cannot be triggered by normal inputs @preserve */
  if (year === undefined || month === undefined || day === undefined) {
    return timestamp.slice(0, 10);
  }
  /* v8 ignore stop @preserve */
  return `${year}-${month}-${day}`;
}

function normalizeChatType(type: string): PrivateWhatsAppChatType {
  if (CHAT_TYPES.has(type as PrivateWhatsAppChatType)) {
    return type as PrivateWhatsAppChatType;
  }
  return 'unknown';
}

function normalizeMessageType(type: string): PrivateWhatsAppMessageType {
  if (MESSAGE_TYPES.has(type as PrivateWhatsAppMessageType)) {
    return type as PrivateWhatsAppMessageType;
  }
  return 'unknown';
}

function summarize(messages: PrivateWhatsAppIngestEventResult[]): PrivateWhatsAppIngestResult {
  return {
    accepted: messages.filter((message) => message.outcome === 'created').length,
    duplicates: messages.filter((message) => message.outcome === 'duplicate').length,
    rejected: messages.filter((message) => message.outcome === 'rejected').length,
    messages,
  };
}
