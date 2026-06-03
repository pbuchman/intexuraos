import type { FastifyInstance, FastifyReply } from 'fastify';
import { logIncomingRequest } from '@intexuraos/common-http';
import { getServices } from '../services.js';
import { withAuth } from './authRoute.js';

interface DigestListQuery {
  groupKey?: string;
  dateFrom?: string;
  dateTo?: string;
  terms?: string;
  limit?: string;
}

interface DigestDetailParams {
  groupKey: string;
  date: string;
}

function isNotFoundError(error: { code: string; status?: number }): boolean {
  return error.code === 'API_ERROR' && error.status === 404;
}

function sendDownstreamError(
  reply: FastifyReply,
  error: { message: string }
): FastifyReply {
  return reply.fail('DOWNSTREAM_ERROR', error.message);
}

function parseTerms(terms: string | undefined): string[] | undefined {
  if (terms === undefined || terms.trim() === '') {
    return undefined;
  }

  const items = terms
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');

  return items.length > 0 ? items : undefined;
}

export function registerDigestsRoutes(app: FastifyInstance): void {
  app.get('/digest-groups', async (request, reply) => {
    logIncomingRequest(request);
    return await withAuth(request, reply, async (user) => {
      const result = await getServices().mobileNotificationsClient.listDigestSubscriptions({
        userId: user.userId,
      });
      if (!result.ok) return await sendDownstreamError(reply, result.error);
      return await reply.ok({ items: result.value.items });
    });
  });

  app.get('/digests', async (request, reply) => {
    logIncomingRequest(request);
    return await withAuth(request, reply, async (user) => {
      const query = request.query as DigestListQuery;
      if (query.groupKey === undefined || query.groupKey === '') {
        return await reply.fail('INVALID_REQUEST', 'groupKey is required.');
      }
      if (query.dateFrom === undefined || query.dateFrom === '') {
        return await reply.fail('INVALID_REQUEST', 'dateFrom is required.');
      }
      if (query.dateTo === undefined || query.dateTo === '') {
        return await reply.fail('INVALID_REQUEST', 'dateTo is required.');
      }

      const terms = parseTerms(query.terms);
      const result = await getServices().mobileNotificationsClient.queryDigests({
        userId: user.userId,
        groupKey: query.groupKey,
        dateFrom: query.dateFrom,
        dateTo: query.dateTo,
        ...(terms !== undefined ? { terms } : {}),
        ...(query.limit !== undefined ? { limit: Number(query.limit) } : {}),
      });
      if (!result.ok) return await sendDownstreamError(reply, result.error);
      return await reply.ok(result.value);
    });
  });

  app.get('/digests/:groupKey/:date', async (request, reply) => {
    logIncomingRequest(request, { includeParams: true });
    return await withAuth(request, reply, async (user) => {
      const params = request.params as DigestDetailParams;
      const digestResult = await getServices().mobileNotificationsClient.getDigest({
        userId: user.userId,
        groupKey: params.groupKey,
        date: params.date,
      });
      if (!digestResult.ok) {
        if (isNotFoundError(digestResult.error)) {
          return await reply.fail('NOT_FOUND', 'Digest not found');
        }
        return await sendDownstreamError(reply, digestResult.error);
      }

      const stateResult = await getServices().mobileNotificationsClient.getDigestState({
        userId: user.userId,
        groupKey: params.groupKey,
      });
      if (!stateResult.ok && !isNotFoundError(stateResult.error)) {
        return await sendDownstreamError(reply, stateResult.error);
      }

      return await reply.ok({
        digest: digestResult.value,
        state: stateResult.ok ? stateResult.value : null,
      });
    });
  });
}
