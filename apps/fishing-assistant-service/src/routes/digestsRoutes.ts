import type { FastifyInstance, FastifyReply } from 'fastify';
import { logIncomingRequest, validateInternalAuth } from '@intexuraos/common-http';
import type {
  LegacyDigestRunProjection,
  MessageDigestServiceClientError,
} from '@intexuraos/internal-clients';
import {
  FISHING_DIGEST_DISPLAY_NAME,
  FISHING_LEGACY_GROUP_KEY,
  isValidFishingLocalDate,
} from '../domain/retrieval/fishingDigestSource.js';
import { getServices } from '../services.js';
import { withAuth } from './authRoute.js';

interface DigestListQuery {
  groupKey?: string;
  dateFrom?: string;
  dateTo?: string;
  terms?: string;
  limit?: string;
  cursor?: string;
}

interface DigestDetailParams {
  groupKey: string;
  date: string;
}

interface DigestCutoverCheckBody {
  userId: string;
  dateFrom: string;
  dateTo: string;
}

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 100;
const MAX_CURSOR_LENGTH = 4_096;
const MAX_TERMS = 20;
const MAX_TERM_LENGTH = 100;
const MAX_CUTOVER_PAGES = 100;
const CUTOVER_VERIFIER_CALLER_ROLE = 'message_digest_cutover_verifier';

const digestCutoverCheckBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['userId', 'dateFrom', 'dateTo'],
  properties: {
    userId: { type: 'string', minLength: 1, maxLength: 256 },
    dateFrom: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
    dateTo: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
  },
} as const;

function sendDownstreamError(
  reply: FastifyReply,
  error: MessageDigestServiceClientError
): FastifyReply {
  if (error.code === 'INVALID_REQUEST') {
    return reply.fail('INVALID_REQUEST', 'Invalid Message Digest request');
  }
  return reply.fail('DOWNSTREAM_ERROR', 'Message Digest service request failed');
}

function parseTerms(terms: string | undefined): string[] | undefined | null {
  if (terms === undefined || terms.trim() === '') return undefined;
  const items = terms
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
  if (items.length === 0) return undefined;
  if (items.length > MAX_TERMS || items.some((item) => item.length > MAX_TERM_LENGTH)) return null;
  return items;
}

function parseListQuery(query: DigestListQuery):
  | {
      ok: true;
      value: {
        dateFrom: string;
        dateTo: string;
        terms?: string[] | undefined;
        limit: number;
        cursor?: string | undefined;
      };
    }
  | { ok: false } {
  if (
    query.groupKey !== FISHING_LEGACY_GROUP_KEY ||
    query.dateFrom === undefined ||
    query.dateTo === undefined ||
    !isValidFishingLocalDate(query.dateFrom) ||
    !isValidFishingLocalDate(query.dateTo) ||
    query.dateFrom > query.dateTo
  ) {
    return { ok: false };
  }
  const limit = query.limit === undefined ? DEFAULT_PAGE_SIZE : Number(query.limit);
  const terms = parseTerms(query.terms);
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > MAX_PAGE_SIZE ||
    terms === null ||
    (query.cursor !== undefined &&
      (query.cursor.length < 1 || query.cursor.length > MAX_CURSOR_LENGTH))
  ) {
    return { ok: false };
  }
  return {
    ok: true,
    value: {
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
      limit,
      ...(terms === undefined ? {} : { terms }),
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
    },
  };
}

function toDigestItem(run: LegacyDigestRunProjection): Record<string, unknown> {
  return {
    groupKey: run.legacyGroupKey,
    date: run.date,
    title: run.title,
    summaryMarkdown: run.summaryMarkdown,
    messageCount: run.messageCount,
  };
}

export function registerDigestsRoutes(app: FastifyInstance): void {
  app.post<{ Body: DigestCutoverCheckBody }>(
    '/internal/fishing-assistant/message-digests/cutover/check',
    {
      schema: {
        operationId: 'checkFishingMessageDigestCutoverVisibility',
        tags: ['internal'],
        security: [{ internalAuth: [] }],
        body: digestCutoverCheckBodySchema,
      },
    },
    async (request, reply) => {
      logIncomingRequest(request, {
        message: 'Received Fishing Message Digest cutover visibility check',
        bodyPreviewLength: 0,
        includeHeaders: false,
        includeParams: false,
      });
      if (
        !validateInternalAuth(request).valid ||
        request.headers['x-internal-caller-role'] !== CUTOVER_VERIFIER_CALLER_ROLE
      ) {
        return await reply.fail('UNAUTHORIZED', 'Fishing cutover authentication failed');
      }
      if (
        !isValidFishingLocalDate(request.body.dateFrom) ||
        !isValidFishingLocalDate(request.body.dateTo) ||
        request.body.dateFrom > request.body.dateTo
      ) {
        return await reply.fail('INVALID_REQUEST', 'Invalid Fishing cutover check');
      }
      let result: Awaited<ReturnType<typeof queryFishingCutoverCounts>>;
      try {
        result = await queryFishingCutoverCounts(request.body);
      } catch {
        return await reply.fail('DOWNSTREAM_ERROR', 'Message Digest service request failed');
      }
      if (!result.ok) {
        return await reply.fail('DOWNSTREAM_ERROR', 'Message Digest service request failed');
      }
      return await reply.ok({
        definitionCount: result.definitionCount,
        runCount: result.runCount,
      });
    }
  );

  app.get('/digest-groups', async (request, reply) => {
    logIncomingRequest(request);
    return await withAuth(request, reply, async (user) => {
      const result = await getServices().messageDigestClient.queryLegacyDigestDefinitions({
        userId: user.userId,
        legacyGroupKey: FISHING_LEGACY_GROUP_KEY,
      });
      if (!result.ok) return await sendDownstreamError(reply, result.error);
      return await reply.ok({
        items: result.value.items.map((item) => ({
          groupKey: item.legacyGroupKey,
          displayName: FISHING_DIGEST_DISPLAY_NAME,
        })),
      });
    });
  });

  app.get('/digests', async (request, reply) => {
    logIncomingRequest(request);
    return await withAuth(request, reply, async (user) => {
      const parsed = parseListQuery(request.query as DigestListQuery);
      if (!parsed.ok) return await reply.fail('INVALID_REQUEST', 'Invalid fishing digest query');
      const result = await getServices().messageDigestClient.queryLegacyDigestRuns({
        userId: user.userId,
        legacyGroupKey: FISHING_LEGACY_GROUP_KEY,
        fromDate: parsed.value.dateFrom,
        toDate: parsed.value.dateTo,
        limit: parsed.value.limit,
        ...(parsed.value.terms === undefined ? {} : { terms: parsed.value.terms }),
        ...(parsed.value.cursor === undefined ? {} : { cursor: parsed.value.cursor }),
      });
      if (!result.ok) return await sendDownstreamError(reply, result.error);
      const items = result.value.items
        .filter((item) => item.legacyGroupKey === FISHING_LEGACY_GROUP_KEY)
        .map(toDigestItem);
      return await reply.ok({
        items,
        truncated: result.value.truncated,
        ...(result.value.nextCursor === null ? {} : { nextCursor: result.value.nextCursor }),
      });
    });
  });

  app.get('/digests/:groupKey/:date', async (request, reply) => {
    logIncomingRequest(request, { includeParams: false });
    return await withAuth(request, reply, async (user) => {
      const params = request.params as DigestDetailParams;
      if (params.groupKey !== FISHING_LEGACY_GROUP_KEY) {
        return await reply.fail('NOT_FOUND', 'Digest not found');
      }
      if (!isValidFishingLocalDate(params.date)) {
        return await reply.fail('INVALID_REQUEST', 'Invalid digest date');
      }
      const result = await getServices().messageDigestClient.queryLegacyDigestRuns({
        userId: user.userId,
        legacyGroupKey: FISHING_LEGACY_GROUP_KEY,
        fromDate: params.date,
        toDate: params.date,
        limit: 1,
      });
      if (!result.ok) return await sendDownstreamError(reply, result.error);
      const digest = result.value.items.find(
        (item) =>
          item.legacyGroupKey === FISHING_LEGACY_GROUP_KEY && item.date === params.date
      );
      if (digest === undefined) return await reply.fail('NOT_FOUND', 'Digest not found');
      return await reply.ok({ digest: toDigestItem(digest), state: null });
    });
  });
}

async function queryFishingCutoverCounts(input: DigestCutoverCheckBody): Promise<
  | { ok: true; definitionCount: number; runCount: number }
  | { ok: false }
> {
  const client = getServices().messageDigestClient;
  const definitions = await client.queryLegacyDigestDefinitions({
    userId: input.userId,
    legacyGroupKey: FISHING_LEGACY_GROUP_KEY,
  });
  if (
    !definitions.ok ||
    definitions.value.items.some((item) => item.legacyGroupKey !== FISHING_LEGACY_GROUP_KEY)
  ) {
    return { ok: false };
  }

  let cursor: string | undefined;
  let runCount = 0;
  const seenCursors = new Set<string>();
  const seenDates = new Set<string>();
  for (let page = 0; page < MAX_CUTOVER_PAGES; page += 1) {
    const runs = await client.queryLegacyDigestRuns({
      userId: input.userId,
      legacyGroupKey: FISHING_LEGACY_GROUP_KEY,
      fromDate: input.dateFrom,
      toDate: input.dateTo,
      limit: MAX_PAGE_SIZE,
      ...(cursor === undefined ? {} : { cursor }),
    });
    if (!runs.ok) return { ok: false };
    for (const run of runs.value.items) {
      if (
        run.legacyGroupKey !== FISHING_LEGACY_GROUP_KEY ||
        run.date < input.dateFrom ||
        run.date > input.dateTo ||
        seenDates.has(run.date)
      ) {
        return { ok: false };
      }
      seenDates.add(run.date);
      runCount += 1;
    }
    if (runs.value.nextCursor === null) {
      if (runs.value.truncated) return { ok: false };
      return {
        ok: true,
        definitionCount: definitions.value.items.length,
        runCount,
      };
    }
    if (!runs.value.truncated || seenCursors.has(runs.value.nextCursor)) return { ok: false };
    seenCursors.add(runs.value.nextCursor);
    cursor = runs.value.nextCursor;
  }
  return { ok: false };
}
