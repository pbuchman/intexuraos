/**
 * Internal routes for mobile-notifications-service.
 * These endpoints are for service-to-service communication only.
 */
import { createHash } from 'node:crypto';
import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { validateInternalAuth, logIncomingRequest } from '@intexuraos/common-http';
import { getServices } from '../services.js';
import { listNotifications } from '../domain/notifications/index.js';
import type { Notification, PaginationOptions } from '../domain/notifications/index.js';
import { findSubscription } from '../domain/digestSubscriptions.js';
import type { DailySummary } from '../domain/schemas/digestSchemas.js';
import type { PersistedDailySummary } from '../domain/repositories/digestRepositories.js';
import { cetDayBounds } from '../domain/usecases/cetDayBounds.js';
import {
  filterAndDedupeNotifications,
  type CleanMessage,
  type RawNotification,
} from '../domain/messageFilter.js';

interface QueryNotificationsBody {
  userId: string;
  filter?: {
    app?: string[];
    source?: string;
    title?: string;
  };
  limit?: number;
}

interface SubscriptionListBody {
  userId: string;
}

interface DigestQueryBody {
  userId: string;
  groupKey: string;
  dateFrom: string;
  dateTo: string;
  terms?: string[];
  limit?: number;
}

interface DigestGetBody {
  userId: string;
  groupKey: string;
  date: string;
}

interface DigestStateGetBody {
  userId: string;
  groupKey: string;
}

interface GroupMessagesQueryBody {
  userId: string;
  groupKey: string;
  date?: string;
  dateFrom?: string;
  dateTo?: string;
  terms?: string[];
  limit?: number;
}

interface DigestEvidenceItem {
  groupKey: string;
  date: string;
  title: string;
  summaryMarkdown: string;
  messageCount: number;
}

interface GroupMessageEvidence {
  messageRef: string;
  groupKey: string;
  date: string;
  postTimeSec: number;
  senderLabel?: string | null;
  text: string;
  quote: string;
}

interface DateRange {
  dateFrom: string;
  dateTo: string;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_DIGEST_LIMIT = 30;
const MAX_DIGEST_LIMIT = 100;
const DEFAULT_GROUP_MESSAGE_LIMIT = 100;
const MAX_GROUP_MESSAGE_LIMIT = 500;
const MAX_GROUP_MESSAGE_RANGE_DAYS = 31;
const RAW_NOTIFICATION_PAGE_SIZE = 1000;
const MAX_RAW_NOTIFICATIONS_TO_SCAN = 5000;

async function rejectInvalidInternalAuth(
  request: FastifyRequest,
  reply: FastifyReply,
  routeName: string
): Promise<boolean> {
  const authResult = validateInternalAuth(request);
  if (!authResult.valid) {
    request.log.warn({ reason: authResult.reason }, `Internal auth failed for ${routeName}`);
    await reply.fail('UNAUTHORIZED', `Internal auth failed for ${routeName}`);
    return true;
  }
  return false;
}

function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE_RE.test(value)) return false;
  const [yearRaw, monthRaw, dayRaw] = value.split('-');
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return false;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function daysInclusive(dateFrom: string, dateTo: string): number {
  const from = Date.parse(`${dateFrom}T00:00:00.000Z`);
  const to = Date.parse(`${dateTo}T00:00:00.000Z`);
  return Math.floor((to - from) / 86_400_000) + 1;
}

function validateDateRange(
  dateFrom: string,
  dateTo: string,
  options: { maxDays?: number } = {}
): string | null {
  if (!isValidIsoDate(dateFrom) || !isValidIsoDate(dateTo)) {
    return 'dates must use YYYY-MM-DD format';
  }
  if (dateFrom > dateTo) {
    return 'dateFrom must be on or before dateTo';
  }
  if (options.maxDays !== undefined && daysInclusive(dateFrom, dateTo) > options.maxDays) {
    return `date range must be ${String(options.maxDays)} days or less`;
  }
  return null;
}

function normalizeLimit(
  value: number | undefined,
  defaultValue: number,
  maxValue: number
): number | null {
  const limit = value ?? defaultValue;
  if (!Number.isInteger(limit) || limit < 1 || limit > maxValue) return null;
  return limit;
}

function normalizeTerms(terms: readonly string[] | undefined): string[] {
  if (terms === undefined) return [];
  return terms.map((term) => term.trim().toLowerCase()).filter((term) => term.length > 0);
}

function textMatchesTerms(text: string, terms: readonly string[]): boolean {
  if (terms.length === 0) return true;
  const haystack = text.toLowerCase();
  return terms.some((term) => haystack.includes(term));
}

function buildDigestMarkdown(summary: DailySummary): string {
  const lines: string[] = [
    `# ${summary.headline}`,
    '',
    `Date: ${summary.date}`,
    `Messages: ${String(summary.messageCount)}`,
  ];

  if (summary.bullets.length > 0) {
    lines.push('', '## Key points');
    for (const bullet of summary.bullets) lines.push(`- ${bullet}`);
  }

  if (summary.threads.length > 0) {
    lines.push('', '## Threads');
    for (const thread of summary.threads) {
      const facts = thread.keyFacts.length > 0 ? `: ${thread.keyFacts.join('; ')}` : '';
      lines.push(`- ${thread.topic}${facts}`);
    }
  }

  if (summary.moderatorPosts.length > 0) {
    lines.push('', '## Moderator posts');
    for (const post of summary.moderatorPosts) {
      lines.push(`- ${post.time} ${post.topic}: ${post.summary}`);
    }
  }

  if (summary.openQuestions.length > 0) {
    lines.push('', '## Open questions');
    for (const question of summary.openQuestions) lines.push(`- ${question}`);
  }

  return lines.join('\n');
}

function toDigestEvidenceItem(doc: PersistedDailySummary): DigestEvidenceItem {
  const { summary } = doc;
  return {
    groupKey: summary.groupKey,
    date: summary.date,
    title: summary.headline,
    summaryMarkdown: buildDigestMarkdown(summary),
    messageCount: summary.messageCount,
  };
}

function resolveGroupMessageRange(body: GroupMessagesQueryBody): DateRange | { error: string } {
  const hasDate = body.date !== undefined && body.date.length > 0;
  const hasRange = body.dateFrom !== undefined || body.dateTo !== undefined;
  if (hasDate && hasRange) {
    return { error: 'provide either date or dateFrom/dateTo, not both' };
  }
  if (hasDate) {
    return { dateFrom: body.date as string, dateTo: body.date as string };
  }
  if (body.dateFrom === undefined || body.dateTo === undefined) {
    return { error: 'date or dateFrom/dateTo is required' };
  }
  return { dateFrom: body.dateFrom, dateTo: body.dateTo };
}

function formatWarsawDateFromSec(postTimeSec: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Warsaw',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(postTimeSec * 1000));
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  return `${year ?? '0000'}-${month ?? '00'}-${day ?? '00'}`;
}

function makeQuote(text: string): string {
  if (text.length <= 240) return text;
  return `${text.slice(0, 237)}...`;
}

function makeMessageRef(groupKey: string, date: string, message: CleanMessage): string {
  const digest = createHash('sha256')
    .update(`${groupKey}\0${date}\0${String(message.postTimeSec)}\0${message.text}`)
    .digest('hex')
    .slice(0, 16);
  return `${groupKey}:${date}:${String(message.postTimeSec)}:${digest}`;
}

function toGroupMessageEvidence(groupKey: string, message: CleanMessage): GroupMessageEvidence {
  const date = formatWarsawDateFromSec(message.postTimeSec);
  const base = {
    messageRef: makeMessageRef(groupKey, date, message),
    groupKey,
    date,
    postTimeSec: message.postTimeSec,
    text: message.text,
    quote: makeQuote(message.text),
  };
  if (message.senderLabel === undefined) return base;
  return { ...base, senderLabel: message.senderLabel };
}

function toRawNotification(notification: Notification): RawNotification {
  return {
    text: notification.text,
    postTime: notification.postTime,
    title: notification.title,
    app: notification.app,
  };
}

export const internalRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.post<{ Body: QueryNotificationsBody }>(
    '/internal/mobile-notifications/query',
    {
      schema: {
        operationId: 'queryNotificationsInternal',
        summary: 'Query notifications (internal)',
        description:
          'Internal endpoint for querying notifications. Used by internal consumers for data aggregation.',
        tags: ['internal'],
        body: {
          type: 'object',
          required: ['userId'],
          properties: {
            userId: { type: 'string', description: 'User ID to query notifications for' },
            filter: {
              type: 'object',
              properties: {
                app: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Filter by app names (OR logic)',
                },
                source: {
                  type: 'string',
                  description: 'Filter by source (single value)',
                },
                title: {
                  type: 'string',
                  description: 'Filter by title (case-insensitive contains)',
                },
              },
            },
            limit: {
              type: 'integer',
              minimum: 1,
              maximum: 1000,
              default: 50,
              description: 'Maximum number of notifications to return',
            },
          },
        },
        response: {
          200: {
            description: 'Notifications retrieved successfully',
            type: 'object',
            required: ['success', 'data'],
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                required: ['notifications'],
                properties: {
                  notifications: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        app: { type: 'string' },
                        title: { type: 'string' },
                        body: { type: 'string' },
                        timestamp: { type: 'string' },
                        source: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
          },
          401: {
            description: 'Unauthorized',
            type: 'object',
            properties: {
              success: { type: 'boolean', const: false },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'error'],
          },
          500: {
            description: 'Internal error',
            type: 'object',
            properties: {
              success: { type: 'boolean', const: false },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'error'],
          },
        },
      },
    },
    async (request: FastifyRequest<{ Body: QueryNotificationsBody }>, reply: FastifyReply) => {
      logIncomingRequest(request, {
        message: 'Received request to /internal/mobile-notifications/query',
        bodyPreviewLength: 200,
      });

      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        request.log.warn(
          { reason: authResult.reason },
          'Internal auth failed for query notifications'
        );
        return await reply.fail('UNAUTHORIZED', 'Internal auth failed for query notifications');
      }

      const { userId, filter, limit = 50 } = request.body;

      const input: {
        userId: string;
        limit: number;
        app?: string[];
        source?: string[];
        title?: string;
      } = { userId, limit };

      if (filter?.app !== undefined && filter.app.length > 0) {
        input.app = filter.app;
      }
      if (filter?.source !== undefined && filter.source.length > 0) {
        input.source = [filter.source];
      }
      if (filter?.title !== undefined && filter.title.length > 0) {
        input.title = filter.title;
      }

      const result = await listNotifications(input, getServices().notificationRepository);

      if (!result.ok) {
        return await reply.fail('INTERNAL_ERROR', result.error.message);
      }

      const notifications = result.value.notifications.map((n) => ({
        id: n.id,
        app: n.app,
        title: n.title,
        body: n.text,
        timestamp: n.receivedAt,
        source: n.source,
      }));

      return await reply.ok({
        notifications,
      });
    }
  );

  fastify.post<{ Body: SubscriptionListBody }>(
    '/internal/notifications/digest-subscriptions/list',
    {
      schema: {
        operationId: 'listDigestSubscriptionsInternal',
        summary: 'List digest subscriptions for a user (internal)',
        tags: ['internal'],
        body: {
          type: 'object',
          required: ['userId'],
          properties: {
            userId: { type: 'string', minLength: 1 },
          },
        },
      },
    },
    async (request, reply) => {
      logIncomingRequest(request, {
        message: 'Received request to /internal/notifications/digest-subscriptions/list',
        bodyPreviewLength: 100,
      });
      if (await rejectInvalidInternalAuth(request, reply, 'list digest subscriptions')) return;

      const items = getServices()
        .digestSubscriptions
        .filter((subscription) => subscription.userId === request.body.userId)
        .map((subscription) => ({
          groupKey: subscription.groupKey,
          displayName: subscription.groupKey,
        }));

      return await reply.ok({ items });
    }
  );

  fastify.post<{ Body: DigestQueryBody }>(
    '/internal/notifications/digests/query',
    {
      schema: {
        operationId: 'queryDigestsInternal',
        summary: 'Query digest evidence by date range (internal)',
        tags: ['internal'],
        body: {
          type: 'object',
          required: ['userId', 'groupKey', 'dateFrom', 'dateTo'],
          properties: {
            userId: { type: 'string', minLength: 1 },
            groupKey: { type: 'string', minLength: 1 },
            dateFrom: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
            dateTo: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
            terms: { type: 'array', items: { type: 'string' }, default: [] },
            limit: { type: 'integer', minimum: 1, maximum: MAX_DIGEST_LIMIT, default: DEFAULT_DIGEST_LIMIT },
          },
        },
      },
    },
    async (request, reply) => {
      logIncomingRequest(request, {
        message: 'Received request to /internal/notifications/digests/query',
        bodyPreviewLength: 120,
      });
      if (await rejectInvalidInternalAuth(request, reply, 'query digests')) return;

      const { userId, groupKey, dateFrom, dateTo } = request.body;
      const rangeError = validateDateRange(dateFrom, dateTo);
      if (rangeError !== null) return await reply.fail('INVALID_REQUEST', rangeError);
      const limit = normalizeLimit(request.body.limit, DEFAULT_DIGEST_LIMIT, MAX_DIGEST_LIMIT);
      if (limit === null) return await reply.fail('INVALID_REQUEST', 'limit is out of range');
      if (findSubscription(getServices().digestSubscriptions, userId, groupKey) === undefined) {
        return await reply.fail('INVALID_REQUEST', `no digest subscription for userId=${userId} groupKey=${groupKey}`);
      }

      const result = await getServices().digestRepository.findInRange({
        userId,
        groupKey,
        fromDate: dateFrom,
        toDate: dateTo,
        limit,
      });
      if (!result.ok) return await reply.fail('INTERNAL_ERROR', result.error.message);

      const terms = normalizeTerms(request.body.terms);
      const matchedItems = result.value.items
        .map(toDigestEvidenceItem)
        .filter((item) => textMatchesTerms(`${item.title}\n${item.summaryMarkdown}`, terms));
      const items = matchedItems.slice(0, limit);

      return await reply.ok({
        items,
        truncated: matchedItems.length > limit || result.value.nextCursor !== undefined,
      });
    }
  );

  fastify.post<{ Body: DigestGetBody }>(
    '/internal/notifications/digests/get',
    {
      schema: {
        operationId: 'getDigestInternal',
        summary: 'Get one digest by date (internal)',
        tags: ['internal'],
        body: {
          type: 'object',
          required: ['userId', 'groupKey', 'date'],
          properties: {
            userId: { type: 'string', minLength: 1 },
            groupKey: { type: 'string', minLength: 1 },
            date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
          },
        },
      },
    },
    async (request, reply) => {
      logIncomingRequest(request, {
        message: 'Received request to /internal/notifications/digests/get',
        bodyPreviewLength: 120,
      });
      if (await rejectInvalidInternalAuth(request, reply, 'get digest')) return;

      const { userId, groupKey, date } = request.body;
      const rangeError = validateDateRange(date, date);
      if (rangeError !== null) return await reply.fail('INVALID_REQUEST', rangeError);
      if (findSubscription(getServices().digestSubscriptions, userId, groupKey) === undefined) {
        return await reply.fail('INVALID_REQUEST', `no digest subscription for userId=${userId} groupKey=${groupKey}`);
      }

      const result = await getServices().digestRepository.findByDate({ userId, groupKey, date });
      if (!result.ok) return await reply.fail('INTERNAL_ERROR', result.error.message);
      // @allow-raw-send -- reply.fail only supports 5xx; 404 needs typed body via reply.status(404).send()
      if (result.value === null) return await reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Digest not found' } });

      return await reply.ok(toDigestEvidenceItem(result.value));
    }
  );

  fastify.post<{ Body: DigestStateGetBody }>(
    '/internal/notifications/digest-state/get',
    {
      schema: {
        operationId: 'getDigestStateInternal',
        summary: 'Get latest digest state for a group (internal)',
        tags: ['internal'],
        body: {
          type: 'object',
          required: ['userId', 'groupKey'],
          properties: {
            userId: { type: 'string', minLength: 1 },
            groupKey: { type: 'string', minLength: 1 },
          },
        },
      },
    },
    async (request, reply) => {
      logIncomingRequest(request, {
        message: 'Received request to /internal/notifications/digest-state/get',
        bodyPreviewLength: 100,
      });
      if (await rejectInvalidInternalAuth(request, reply, 'get digest state')) return;

      const { userId, groupKey } = request.body;
      if (findSubscription(getServices().digestSubscriptions, userId, groupKey) === undefined) {
        return await reply.fail('INVALID_REQUEST', `no digest subscription for userId=${userId} groupKey=${groupKey}`);
      }

      const result = await getServices().groupStateRepository.getLatest({ userId, groupKey });
      if (!result.ok) return await reply.fail('INTERNAL_ERROR', result.error.message);
      // @allow-raw-send -- reply.fail only supports 5xx; 404 needs typed body via reply.status(404).send()
      if (result.value === null) return await reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'State not found' } });

      return await reply.ok(result.value);
    }
  );

  fastify.post<{ Body: GroupMessagesQueryBody }>(
    '/internal/notifications/group-messages/query',
    {
      schema: {
        operationId: 'queryGroupMessagesInternal',
        summary: 'Query cleaned group messages by date range (internal)',
        tags: ['internal'],
        body: {
          type: 'object',
          required: ['userId', 'groupKey'],
          properties: {
            userId: { type: 'string', minLength: 1 },
            groupKey: { type: 'string', minLength: 1 },
            date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
            dateFrom: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
            dateTo: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
            terms: { type: 'array', items: { type: 'string' }, default: [] },
            limit: {
              type: 'integer',
              minimum: 1,
              maximum: MAX_GROUP_MESSAGE_LIMIT,
              default: DEFAULT_GROUP_MESSAGE_LIMIT,
            },
          },
        },
      },
    },
    async (request, reply) => {
      logIncomingRequest(request, {
        message: 'Received request to /internal/notifications/group-messages/query',
        bodyPreviewLength: 120,
      });
      if (await rejectInvalidInternalAuth(request, reply, 'query group messages')) return;

      const { userId, groupKey } = request.body;
      const resolvedRange = resolveGroupMessageRange(request.body);
      if ('error' in resolvedRange) return await reply.fail('INVALID_REQUEST', resolvedRange.error);
      const rangeError = validateDateRange(resolvedRange.dateFrom, resolvedRange.dateTo, {
        maxDays: MAX_GROUP_MESSAGE_RANGE_DAYS,
      });
      if (rangeError !== null) return await reply.fail('INVALID_REQUEST', rangeError);
      const limit = normalizeLimit(
        request.body.limit,
        DEFAULT_GROUP_MESSAGE_LIMIT,
        MAX_GROUP_MESSAGE_LIMIT
      );
      if (limit === null) return await reply.fail('INVALID_REQUEST', 'limit is out of range');

      const subscription = findSubscription(getServices().digestSubscriptions, userId, groupKey);
      if (subscription === undefined) {
        return await reply.fail('INVALID_REQUEST', `no digest subscription for userId=${userId} groupKey=${groupKey}`);
      }

      const fromBounds = cetDayBounds(resolvedRange.dateFrom);
      const toBounds = cetDayBounds(resolvedRange.dateTo);
      const rawNotifications: Notification[] = [];
      let cursor: string | undefined;
      let rawScanTruncated = false;

      do {
        const pageLimit = Math.min(
          RAW_NOTIFICATION_PAGE_SIZE,
          MAX_RAW_NOTIFICATIONS_TO_SCAN - rawNotifications.length
        );
        const options: PaginationOptions = {
          limit: pageLimit,
          filter: {
            app: ['com.whatsapp'],
            title: subscription.groupTitlePrefix,
            postTimeSecFrom: fromBounds.fromSec,
            postTimeSecTo: toBounds.toSec,
          },
        };
        if (cursor !== undefined) options.cursor = cursor;

        const page = await getServices().notificationRepository.findByUserIdPaginated(
          userId,
          options
        );
        if (!page.ok) return await reply.fail('INTERNAL_ERROR', page.error.message);

        rawNotifications.push(...page.value.notifications);
        cursor = page.value.nextCursor;
        if (cursor !== undefined && rawNotifications.length >= MAX_RAW_NOTIFICATIONS_TO_SCAN) {
          rawScanTruncated = true;
          break;
        }
      } while (cursor !== undefined);

      const cleaned = filterAndDedupeNotifications(rawNotifications.map(toRawNotification));
      const terms = normalizeTerms(request.body.terms);
      const matched = cleaned.filter((message) => textMatchesTerms(message.text, terms));
      const messages = matched.slice(0, limit).map((message) => toGroupMessageEvidence(groupKey, message));

      return await reply.ok({
        messages,
        totalRaw: rawNotifications.length,
        totalCleaned: cleaned.length,
        returned: messages.length,
        truncated: rawScanTruncated || matched.length > limit,
      });
    }
  );

  done();
};
