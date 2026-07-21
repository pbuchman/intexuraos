import { z } from 'zod';

const MatrixUserIdSchema = z
  .string()
  .min(4)
  .max(255)
  .regex(/^@[^\s:]+:[^\s]+$/u);

const MatrixRoomIdSchema = z
  .string()
  .min(4)
  .max(255)
  .regex(/^![^\s:]+:[^\s]+$/u);

const MatrixEventIdSchema = z
  .string()
  .min(2)
  .max(4_096)
  .regex(/^\$[^\s]+$/u);

const MatrixWhoAmISchema = z
  .object({
    user_id: MatrixUserIdSchema,
    device_id: z.string().min(1).optional(),
    is_guest: z.boolean().optional(),
  })
  .strict();

const MatrixRelationSchema = z
  .record(z.string().min(1).max(255), z.unknown())
  .superRefine((value, context) => {
    if (Object.keys(value).length > 16) {
      context.addIssue({ code: 'custom', message: 'relation field limit exceeded' });
    }
    if (Object.hasOwn(value, 'rel_type')) {
      const relType = value['rel_type'];
      if (typeof relType !== 'string' || relType.length === 0 || relType.length > 255) {
        context.addIssue({ code: 'custom', message: 'invalid relation type' });
      }
    }
  })
  .transform((value): { rel_type?: string } => {
    const relType = Object.hasOwn(value, 'rel_type') ? value['rel_type'] : undefined;
    return typeof relType === 'string' ? { rel_type: relType } : {};
  });

const MatrixTimelineEventSchema = z
  .object({
    event_id: MatrixEventIdSchema.optional(),
    origin_server_ts: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    redacts: MatrixEventIdSchema.optional(),
    type: z.string().min(1).max(255),
    sender: z.string().min(1).max(255),
    content: z
      .object({
        msgtype: z.string().min(1).max(255).optional(),
        body: z.string().max(8_192).optional(),
        'm.relates_to': MatrixRelationSchema.optional(),
      })
      .strict()
      .optional(),
    unsigned: z
      .object({
        redacted_because: z.unknown().optional(),
      })
      .strict()
      .transform((value): { redacted_because?: true } =>
        Object.hasOwn(value, 'redacted_because') ? { redacted_because: true } : {}
      )
      .optional(),
  })
  .strict()
  .transform(
    (value): MatrixTimelineEvent => ({
      ...(value.event_id !== undefined ? { eventId: value.event_id } : {}),
      ...(value.origin_server_ts !== undefined ? { originServerTs: value.origin_server_ts } : {}),
      ...(value.redacts !== undefined ? { redacts: value.redacts } : {}),
      type: value.type,
      sender: value.sender,
      ...(value.content !== undefined
        ? {
            content: {
              ...(value.content.msgtype !== undefined ? { msgtype: value.content.msgtype } : {}),
              ...(value.content.body !== undefined ? { body: value.content.body } : {}),
              ...(value.content['m.relates_to'] !== undefined
                ? { 'm.relates_to': value.content['m.relates_to'] }
                : {}),
            },
          }
        : {}),
      ...(value.unsigned !== undefined ? { unsigned: value.unsigned } : {}),
    })
  );

export type MatrixWhoAmIResult =
  | { ok: true; userId: string }
  | {
      ok: false;
      reason: 'unauthorized' | 'timeout' | 'unavailable' | 'invalid_response';
    };

export interface MatrixTimelineEvent {
  eventId?: string;
  originServerTs?: number;
  redacts?: string;
  type: string;
  sender: string;
  content?: {
    msgtype?: string;
    body?: string;
    'm.relates_to'?: { rel_type?: string };
  };
  unsigned?: { redacted_because?: unknown };
}

export type MatrixTargetSyncResult =
  | {
      ok: true;
      nextBatch: string;
      limited: boolean;
      events: readonly MatrixTimelineEvent[];
    }
  | {
      ok: false;
      reason: 'unauthorized' | 'timeout' | 'unavailable' | 'invalid_response';
    };

export interface MatrixTargetSyncInput {
  homeserverUrl: string;
  accessToken: string;
  targetRoomId: string;
  since?: string;
  timeoutMs: 0 | 30_000;
  signal: AbortSignal;
}

export interface MatrixClient {
  whoAmI(input: { homeserverUrl: string; accessToken: string }): Promise<MatrixWhoAmIResult>;
  syncTargetRoom(input: MatrixTargetSyncInput): Promise<MatrixTargetSyncResult>;
}

export interface MatrixClientOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
}

const MATRIX_WHOAMI_TIMEOUT_MS = 10_000;
const MATRIX_JSON_MAX_BYTES = 64 * 1024;

function isJsonResponse(response: Response): boolean {
  const contentType = response.headers.get('content-type');
  return contentType !== null && /^application\/json(?:\s*;|$)/iu.test(contentType.trim());
}

async function readBoundedBody(
  response: Response,
  maxBytes: number
): Promise<Uint8Array | undefined> {
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null) {
    const parsedLength = Number(contentLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0 || parsedLength > maxBytes) {
      return undefined;
    }
  }

  if (response.body === null) {
    return new Uint8Array();
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) {
        const body = new Uint8Array(totalBytes);
        let offset = 0;
        for (const part of chunks) {
          body.set(part, offset);
          offset += part.byteLength;
        }
        return body;
      }

      const value: unknown = chunk.value;
      if (!(value instanceof Uint8Array)) {
        return undefined;
      }
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return undefined;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
}

function buildWhoAmIUrl(homeserverUrl: string): string | undefined {
  try {
    return new URL('/_matrix/client/v3/account/whoami', homeserverUrl).toString();
  } catch {
    return undefined;
  }
}

const MATRIX_SYNC_EVENT_TYPES = [
  'm.room.message',
  'm.reaction',
  'm.room.redaction',
  'm.sticker',
] as const;

const MATRIX_SYNC_EVENT_FIELDS = [
  'event_id',
  'origin_server_ts',
  'redacts',
  'type',
  'sender',
  'content.msgtype',
  'content.body',
  'content.m\\.relates_to',
  'unsigned.redacted_because',
] as const;

function isMatrixSyncTimeout(value: number): value is 0 | 30_000 {
  return value === 0 || value === 30_000;
}

function buildTargetSyncUrl(input: MatrixTargetSyncInput): string | undefined {
  if (
    !MatrixRoomIdSchema.safeParse(input.targetRoomId).success ||
    !isMatrixSyncTimeout(input.timeoutMs) ||
    (input.timeoutMs === 0 && input.since !== undefined) ||
    (input.timeoutMs === 30_000 &&
      (input.since === undefined || input.since.length === 0 || input.since.length > 4_096))
  ) {
    return undefined;
  }

  try {
    const url = new URL('/_matrix/client/v3/sync', input.homeserverUrl);
    url.searchParams.set('timeout', String(input.timeoutMs));
    url.searchParams.set('set_presence', 'offline');
    if (input.since !== undefined) {
      url.searchParams.set('since', input.since);
    }
    url.searchParams.set(
      'filter',
      JSON.stringify({
        event_fields: MATRIX_SYNC_EVENT_FIELDS,
        presence: { types: [] },
        account_data: { types: [] },
        room: {
          rooms: [input.targetRoomId],
          account_data: { types: [] },
          ephemeral: { types: [] },
          state: { types: [] },
          timeline: {
            limit: 100,
            types: MATRIX_SYNC_EVENT_TYPES,
          },
        },
      })
    );
    return url.toString();
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function ownValue(record: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

function parseTargetSyncBody(
  raw: unknown,
  targetRoomId: string
): Exclude<MatrixTargetSyncResult, { ok: false }> | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }

  const nextBatch = ownValue(raw, 'next_batch');
  if (typeof nextBatch !== 'string' || nextBatch.length === 0 || nextBatch.length > 4_096) {
    return undefined;
  }

  const emptyUpdate = (): Exclude<MatrixTargetSyncResult, { ok: false }> => ({
    ok: true,
    nextBatch,
    limited: false,
    events: [],
  });

  const rooms = ownValue(raw, 'rooms');
  if (rooms === undefined) {
    return emptyUpdate();
  }
  if (!isRecord(rooms)) {
    return undefined;
  }
  const joinedRooms = ownValue(rooms, 'join');
  if (joinedRooms === undefined) {
    return emptyUpdate();
  }
  if (!isRecord(joinedRooms)) {
    return undefined;
  }
  if (!Object.hasOwn(joinedRooms, targetRoomId)) {
    return emptyUpdate();
  }
  const targetRoom = joinedRooms[targetRoomId];
  if (!isRecord(targetRoom)) {
    return undefined;
  }
  const timeline = ownValue(targetRoom, 'timeline');
  if (timeline === undefined) {
    return emptyUpdate();
  }
  if (!isRecord(timeline)) {
    return undefined;
  }
  const rawEvents = ownValue(timeline, 'events');
  if (rawEvents !== undefined && (!Array.isArray(rawEvents) || rawEvents.length > 100)) {
    return undefined;
  }
  const events = z
    .array(MatrixTimelineEventSchema)
    .max(100)
    .safeParse(rawEvents ?? []);
  if (!events.success) {
    return undefined;
  }

  const rawLimited = ownValue(timeline, 'limited');
  if (rawLimited !== undefined && typeof rawLimited !== 'boolean') {
    return undefined;
  }

  return {
    ok: true,
    nextBatch,
    limited: rawLimited ?? false,
    events: events.data,
  };
}

export function isWhatsAppPuppetSender(value: string): boolean {
  return /^@whatsapp_(?:[0-9]+|lid-[A-Za-z0-9_-]+):/u.test(value);
}

export function createMatrixClient(options: MatrixClientOptions = {}): MatrixClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? MATRIX_WHOAMI_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? MATRIX_JSON_MAX_BYTES;

  return {
    async whoAmI(input): Promise<MatrixWhoAmIResult> {
      const url = buildWhoAmIUrl(input.homeserverUrl);
      if (url === undefined) {
        return { ok: false, reason: 'invalid_response' };
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => {
        controller.abort();
      }, timeoutMs);
      try {
        const response = await fetchImpl(url, {
          method: 'GET',
          headers: {
            accept: 'application/json',
            authorization: `Bearer ${input.accessToken}`,
          },
          redirect: 'error',
          signal: controller.signal,
        });
        if (response.status === 401) {
          return { ok: false, reason: 'unauthorized' };
        }
        if (response.status !== 200) {
          return { ok: false, reason: 'unavailable' };
        }
        if (!isJsonResponse(response)) {
          return { ok: false, reason: 'invalid_response' };
        }

        const body = await readBoundedBody(response, maxBytes);
        if (body === undefined) {
          return { ok: false, reason: 'invalid_response' };
        }

        let raw: unknown;
        try {
          const text = new TextDecoder('utf-8', { fatal: true }).decode(body);
          raw = JSON.parse(text) as unknown;
        } catch {
          return { ok: false, reason: 'invalid_response' };
        }
        const parsed = MatrixWhoAmISchema.safeParse(raw);
        return parsed.success
          ? { ok: true, userId: parsed.data.user_id }
          : { ok: false, reason: 'invalid_response' };
      } catch {
        return {
          ok: false,
          reason: controller.signal.aborted ? 'timeout' : 'unavailable',
        };
      } finally {
        clearTimeout(timeout);
      }
    },

    async syncTargetRoom(input): Promise<MatrixTargetSyncResult> {
      const url = buildTargetSyncUrl(input);
      if (url === undefined) {
        return { ok: false, reason: 'invalid_response' };
      }

      try {
        const response = await fetchImpl(url, {
          method: 'GET',
          headers: {
            accept: 'application/json',
            authorization: `Bearer ${input.accessToken}`,
          },
          redirect: 'error',
          signal: input.signal,
        });
        if (response.status === 401 || response.status === 403) {
          return { ok: false, reason: 'unauthorized' };
        }
        if (response.status !== 200) {
          return { ok: false, reason: 'unavailable' };
        }
        if (!isJsonResponse(response)) {
          return { ok: false, reason: 'invalid_response' };
        }

        const body = await readBoundedBody(response, maxBytes);
        if (body === undefined) {
          return { ok: false, reason: 'invalid_response' };
        }

        let raw: unknown;
        try {
          raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)) as unknown;
        } catch {
          return { ok: false, reason: 'invalid_response' };
        }
        return (
          parseTargetSyncBody(raw, input.targetRoomId) ?? {
            ok: false,
            reason: 'invalid_response',
          }
        );
      } catch {
        return {
          ok: false,
          reason: input.signal.aborted ? 'timeout' : 'unavailable',
        };
      }
    },
  };
}
