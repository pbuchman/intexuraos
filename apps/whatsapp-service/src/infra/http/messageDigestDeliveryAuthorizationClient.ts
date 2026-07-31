import {
  createInternalHttpClient,
  type InternalHttpClientLogger,
} from '@intexuraos/internal-clients';
import { z } from 'zod';
import type {
  MessageDigestDeliveryAuthorizationClient,
  MessageDigestDeliveryAuthorizationIdentity,
} from '../../domain/whatsapp/ports/messageDigestDeliveryAuthorization.js';

const CALLER_ROLE = 'whatsapp_message_digest_delivery';

const identitySchema = z
  .object({
    userId: z.string().trim().min(1).max(256),
    definitionId: z.string().regex(/^md_[A-Za-z0-9_-]{3,120}$/u),
    runId: z.string().regex(/^mdr_[A-Za-z0-9_-]{3,160}$/u),
    idempotencyKey: z.string().min(1).max(256),
    payloadDigest: z.string().regex(/^[0-9a-f]{64}$/u),
    ownerDigest: z.string().regex(/^[0-9a-f]{64}$/u),
  })
  .strict()
  .superRefine((identity, context) => {
    if (identity.idempotencyKey !== `message-digest:${identity.runId}`) {
      context.addIssue({
        code: 'custom',
        message: 'Delivery identity does not match its idempotency key',
        path: ['idempotencyKey'],
      });
    }
  });

const acquireResponseSchema = z.discriminatedUnion('disposition', [
  z
    .object({
      disposition: z.literal('authorized'),
      fence: z.number().int().positive(),
      expiresAt: z.string().datetime({ offset: true }),
    })
    .strict(),
  z.object({ disposition: z.literal('denied') }).strict(),
  z.object({ disposition: z.literal('busy') }).strict(),
]);

const releaseResponseSchema = z
  .object({ disposition: z.enum(['released', 'ignored']) })
  .strict();

export interface MessageDigestDeliveryAuthorizationClientConfig {
  baseUrl: string;
  internalAuthToken: string;
  logger: Pick<InternalHttpClientLogger, 'warn'>;
}

export function createMessageDigestDeliveryAuthorizationClient(
  config: MessageDigestDeliveryAuthorizationClientConfig
): MessageDigestDeliveryAuthorizationClient {
  const http = createInternalHttpClient({
    baseUrl: config.baseUrl,
    token: config.internalAuthToken,
    logger: config.logger,
  });
  const requestOptions = {
    extraHeaders: { 'x-internal-caller-role': CALLER_ROLE },
    privateRequest: true,
    skipSentry: true,
  } as const;

  return {
    async acquire(
      input
    ): ReturnType<MessageDigestDeliveryAuthorizationClient['acquire']> {
      const identity = parseIdentity(input);
      if (identity === null) return { ok: false, code: 'invalid_request' };
      const response = await http.request<unknown>({
        method: 'POST',
        path: '/internal/message-digests/delivery-authorizations/acquire',
        body: identity,
        ...requestOptions,
      });
      if (!response.ok) return { ok: false, code: 'unavailable' };
      const parsed = acquireResponseSchema.safeParse(response.value);
      if (!parsed.success) return { ok: false, code: 'invalid_response' };
      return { ok: true, ...parsed.data };
    },

    async release(
      input
    ): ReturnType<MessageDigestDeliveryAuthorizationClient['release']> {
      const { fence, ...identityInput } = input;
      const identity = parseIdentity(identityInput);
      if (
        identity === null ||
        !Number.isInteger(fence) ||
        fence <= 0
      ) {
        return { ok: false, code: 'invalid_request' };
      }
      const response = await http.request<unknown>({
        method: 'POST',
        path: '/internal/message-digests/delivery-authorizations/release',
        body: { ...identity, fence },
        ...requestOptions,
      });
      if (!response.ok) return { ok: false, code: 'unavailable' };
      const parsed = releaseResponseSchema.safeParse(response.value);
      return parsed.success
        ? { ok: true }
        : { ok: false, code: 'invalid_response' };
    },
  };
}

function parseIdentity(
  input: MessageDigestDeliveryAuthorizationIdentity
): MessageDigestDeliveryAuthorizationIdentity | null {
  const parsed = identitySchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}
