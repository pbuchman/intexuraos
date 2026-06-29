import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { logIncomingRequest, requireAuth, validateInternalAuth } from '@intexuraos/common-http';
import { createPrivateWhatsAppMessageId, type PrivateWhatsAppMessage } from '../domain/whatsapp/index.js';
import { getExtensionFromMimeType } from '../domain/whatsapp/utils/mimeType.js';
import { getServices } from '../services.js';

type ValidatedRequest = FastifyRequest & { validationError?: unknown };
const PRIVATE_MEDIA_SIGNED_URL_TTL_SECONDS = 900;

interface PrivateMediaUploadQuerystring {
  sourceAccountId: string;
  matrixEventId: string;
  mxcUri: string;
  mediaId?: string;
  mimeType?: string;
  fileName?: string;
  sha256?: string;
}

interface PrivateMediaParams {
  messageId: string;
}

interface PrivateMediaAccessQuerystring {
  token: string;
}

interface InternalPrivateMediaQuerystring {
  sourceAccountId: string;
  variant?: 'original' | 'thumbnail';
}

interface PublicPrivateMediaAccessTokenPayload {
  messageId: string;
  variant: 'original' | 'thumbnail';
  expiresAtEpochSeconds: number;
}

const PUBLIC_MEDIA_TOKEN_SIGNATURE_BYTES = 8;

function privateMediaErrorResponse(description: string): Record<string, unknown> {
  return {
    description,
    type: 'object',
    properties: {
      success: { type: 'boolean', const: false },
      error: { $ref: 'ErrorBody#' },
      diagnostics: { $ref: 'Diagnostics#' },
    },
    required: ['success', 'error'],
  };
}

function sanitizeMediaId(value: string): string {
  const compact = value.replace(/[^A-Za-z0-9_-]/g, '-').replace(/-+/g, '-');
  if (compact.length > 0 && compact.length <= 80) {
    return compact;
  }
  return createHash('sha256').update(value).digest('hex').slice(0, 32);
}

function getBufferBody(request: FastifyRequest): Buffer | null {
  return Buffer.isBuffer(request.body) ? request.body : null;
}

function isImageMimeType(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}

function isAudioMimeType(mimeType: string): boolean {
  return mimeType.startsWith('audio/');
}

function isVideoMimeType(mimeType: string): boolean {
  return mimeType.startsWith('video/');
}

function isSupportedUploadMimeType(mimeType: string): boolean {
  return isImageMimeType(mimeType) || isAudioMimeType(mimeType) || isVideoMimeType(mimeType);
}

function isPrivateImageMessage(message: PrivateWhatsAppMessage): boolean {
  return message.messageType === 'image';
}

function getOriginalPath(message: PrivateWhatsAppMessage): string | undefined {
  return message.media?.gcsPath;
}

function getThumbnailPath(message: PrivateWhatsAppMessage): string | undefined {
  return message.media?.thumbnailGcsPath;
}

function toExpiresAt(ttlSeconds: number): string {
  return new Date(Date.now() + ttlSeconds * 1000).toISOString();
}

function createPublicPrivateMediaToken(
  messageId: string,
  variant: 'original' | 'thumbnail',
  secret: string
): { token: string; expiresAt: string } {
  const expiresAt = toExpiresAt(PRIVATE_MEDIA_SIGNED_URL_TTL_SECONDS);
  const payload: PublicPrivateMediaAccessTokenPayload = {
    messageId,
    variant,
    expiresAtEpochSeconds: Math.floor(Date.parse(expiresAt) / 1000),
  };
  const variantCode = payload.variant === 'thumbnail' ? 't' : 'o';
  const compressedPayload = deflateRawSync(
    Buffer.from(
      `${payload.messageId}\n${variantCode}\n${String(payload.expiresAtEpochSeconds)}`,
      'utf8'
    )
  );
  const signature = createHmac('sha256', secret)
    .update(compressedPayload)
    .digest()
    .subarray(0, PUBLIC_MEDIA_TOKEN_SIGNATURE_BYTES);
  return {
    token: Buffer.concat([signature, compressedPayload]).toString('base64url'),
    expiresAt,
  };
}

function parsePublicPrivateMediaToken(
  token: string,
  secret: string
): PublicPrivateMediaAccessTokenPayload | null {
  try {
    const decodedToken = Buffer.from(token, 'base64url');
    if (decodedToken.length <= PUBLIC_MEDIA_TOKEN_SIGNATURE_BYTES) {
      return null;
    }
    const providedSignature = decodedToken.subarray(0, PUBLIC_MEDIA_TOKEN_SIGNATURE_BYTES);
    const compressedPayload = decodedToken.subarray(PUBLIC_MEDIA_TOKEN_SIGNATURE_BYTES);
    const expectedSignature = createHmac('sha256', secret)
      .update(compressedPayload)
      .digest()
      .subarray(0, PUBLIC_MEDIA_TOKEN_SIGNATURE_BYTES);
    if (!timingSafeEqual(providedSignature, expectedSignature)) {
      return null;
    }

    const [messageId, variantCode, expiresAtEpochSecondsRaw] = inflateRawSync(compressedPayload)
      .toString('utf8')
      .split('\n');
    const expiresAtEpochSeconds = Number.parseInt(expiresAtEpochSecondsRaw ?? '', 10);
    const variant =
      variantCode === 't' ? 'thumbnail' : variantCode === 'o' ? 'original' : null;
    if (
      typeof messageId !== 'string' ||
      messageId.length === 0 ||
      variant === null ||
      Number.isNaN(expiresAtEpochSeconds)
    ) {
      return null;
    }
    if (expiresAtEpochSeconds * 1000 <= Date.now()) {
      return null;
    }

    return {
      messageId,
      variant,
      expiresAtEpochSeconds,
    };
  } catch {
    return null;
  }
}

async function getPrivateMessageForPublicUser(
  messageId: string,
  userId: string,
  reply: FastifyReply
): Promise<PrivateWhatsAppMessage | null> {
  const services = getServices();
  const accountResult = await services.privateWhatsAppRepository.getAccountByUserId(userId);
  if (!accountResult.ok) {
    await reply.fail('INTERNAL_ERROR', accountResult.error.message);
    return null;
  }
  if (accountResult.value?.status !== 'active') {
    await reply.fail('NOT_FOUND', 'Private WhatsApp mirror is not configured');
    return null;
  }

  const messageResult = await services.privateWhatsAppRepository.getMessageById(messageId);
  if (!messageResult.ok) {
    await reply.fail('INTERNAL_ERROR', messageResult.error.message);
    return null;
  }
  const message = messageResult.value;
  if (
    message?.userId !== userId ||
    message.sourceAccountId !== accountResult.value.sourceAccountId
  ) {
    await reply.fail('NOT_FOUND', 'Private WhatsApp message not found');
    return null;
  }
  return message;
}

function getPrivateImageMediaPath(
  message: PrivateWhatsAppMessage,
  variant: 'original' | 'thumbnail'
): string | null {
  if (!isPrivateImageMessage(message)) {
    return null;
  }
  const gcsPath = variant === 'thumbnail' ? getThumbnailPath(message) : getOriginalPath(message);
  return gcsPath ?? null;
}

async function getSignedPrivateMediaUrlData(
  message: PrivateWhatsAppMessage,
  variant: 'original' | 'thumbnail',
  includeInternalMedia: boolean
): Promise<
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; errorCode: 'NOT_FOUND' | 'DOWNSTREAM_ERROR'; message: string }
> {
  const gcsPath = getPrivateImageMediaPath(message, variant);
  if (gcsPath === null) {
    return {
      ok: false,
      errorCode: 'NOT_FOUND',
      message: `Private WhatsApp message has no ${variant} media`,
    };
  }
  const urlResult = await getServices().mediaStorage.getSignedUrl(
    gcsPath,
    PRIVATE_MEDIA_SIGNED_URL_TTL_SECONDS
  );
  if (!urlResult.ok) {
    return {
      ok: false,
      errorCode: 'DOWNSTREAM_ERROR',
      message: urlResult.error.message,
    };
  }
  const data: Record<string, unknown> = {
    url: urlResult.value,
    expiresAt: toExpiresAt(PRIVATE_MEDIA_SIGNED_URL_TTL_SECONDS),
  };
  if (includeInternalMedia) {
    data['media'] = {
      gcsPath,
      mimeType: message.media?.storedMimeType ?? message.media?.mimeType,
      sizeBytes: message.media?.storedSizeBytes ?? message.media?.sizeBytes,
    };
  }
  return { ok: true, data };
}

async function replyWithSignedPrivateMediaUrl(
  reply: FastifyReply,
  message: PrivateWhatsAppMessage,
  variant: 'original' | 'thumbnail',
  includeInternalMedia: boolean
): Promise<FastifyReply> {
  const result = await getSignedPrivateMediaUrlData(message, variant, includeInternalMedia);
  if (!result.ok) {
    return await reply.fail(result.errorCode, result.message);
  }
  return await reply.ok(result.data);
}

function getPublicMediaTokenSecret(): string {
  return process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] ?? '';
}

export const privateMediaRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  const publicMediaTokenSecret = getPublicMediaTokenSecret();
    fastify.post<{ Querystring: PrivateMediaUploadQuerystring }>(
      '/internal/whatsapp/private/media',
      {
        bodyLimit: 25 * 1024 * 1024,
        attachValidation: true,
        schema: {
          operationId: 'uploadPrivateWhatsAppMedia',
          summary: 'Upload private WhatsApp media',
          tags: ['internal'],
          querystring: {
            type: 'object',
            additionalProperties: false,
            properties: {
              sourceAccountId: { type: 'string', minLength: 1 },
              matrixEventId: { type: 'string', minLength: 1 },
              mxcUri: { type: 'string', minLength: 1 },
              mediaId: { type: 'string', minLength: 1 },
              mimeType: { type: 'string', minLength: 1 },
              fileName: { type: 'string', minLength: 1 },
              sha256: { type: 'string', minLength: 1 },
            },
            required: ['sourceAccountId', 'matrixEventId', 'mxcUri', 'mimeType'],
          },
          response: {
            200: {
              description: 'Private WhatsApp media uploaded successfully',
              type: 'object',
              properties: {
                success: { type: 'boolean', const: true },
                data: {
                  type: 'object',
                  properties: {
                    media: {
                      type: 'object',
                      properties: {
                        mxcUri: { type: 'string' },
                        mimeType: { type: 'string' },
                        fileName: { type: 'string' },
                        sizeBytes: { type: 'number' },
                        sha256: { type: 'string' },
                        storageStatus: { type: 'string', enum: ['stored'] },
                        gcsPath: { type: 'string' },
                        thumbnailGcsPath: { type: 'string' },
                        storedMimeType: { type: 'string' },
                        storedSizeBytes: { type: 'number' },
                        storedAt: { type: 'string', format: 'date-time' },
                      },
                      required: [
                        'mxcUri',
                        'mimeType',
                        'sizeBytes',
                        'storageStatus',
                        'gcsPath',
                        'storedMimeType',
                        'storedSizeBytes',
                        'storedAt',
                      ],
                    },
                  },
                  required: ['media'],
                },
                diagnostics: { $ref: 'Diagnostics#' },
              },
              required: ['success', 'data'],
            },
            400: privateMediaErrorResponse('Invalid request'),
            401: privateMediaErrorResponse('Unauthorized'),
            404: privateMediaErrorResponse('Private WhatsApp account not found'),
            413: privateMediaErrorResponse('Payload too large'),
            500: privateMediaErrorResponse('Internal error'),
            502: privateMediaErrorResponse('Downstream error'),
          },
        },
      },
      async (request, reply) => {
        logIncomingRequest(request, {
          message: 'Received request to POST /internal/whatsapp/private/media',
          bodyPreviewLength: 0,
          additionalFields: {
            route: 'internal_whatsapp_private_media_upload',
            hasSourceAccountId: typeof request.query.sourceAccountId === 'string',
            hasMatrixEventId: typeof request.query.matrixEventId === 'string',
            hasMxcUri: typeof request.query.mxcUri === 'string',
            hasMimeType: typeof request.query.mimeType === 'string',
          },
        });

        const authResult = validateInternalAuth(request);
        if (!authResult.valid) {
          return await reply.fail(
            'UNAUTHORIZED',
            'Internal auth failed for private WhatsApp media upload'
          );
        }

        const validatedRequest = request as ValidatedRequest;
        if (validatedRequest.validationError !== undefined) {
          return await reply.fail('INVALID_REQUEST', 'Validation failed');
        }

        const buffer = getBufferBody(request);
        if (buffer === null || buffer.length === 0) {
          return await reply.fail('INVALID_REQUEST', 'Missing media body');
        }

        const mimeType = request.query.mimeType;
        if (mimeType === undefined || !isSupportedUploadMimeType(mimeType)) {
          return await reply.fail(
            'INVALID_REQUEST',
            'mimeType must be an image, audio, or video MIME type'
          );
        }

        const services = getServices();
        const accountResult =
          await services.privateWhatsAppRepository.getActiveAccountBySourceAccountId(
            request.query.sourceAccountId
          );
        if (!accountResult.ok) {
          return await reply.fail('INTERNAL_ERROR', accountResult.error.message);
        }
        if (accountResult.value === null) {
          return await reply.fail('NOT_FOUND', 'Private WhatsApp source account is not active');
        }
        const extension = getExtensionFromMimeType(mimeType);
        const messageId = createPrivateWhatsAppMessageId(
          request.query.sourceAccountId,
          request.query.matrixEventId
        );
        const mediaId = sanitizeMediaId(request.query.mediaId ?? request.query.mxcUri);

        const uploadResult = await services.mediaStorage.uploadPrivateMedia(
          accountResult.value.userId,
          messageId,
          mediaId,
          extension,
          buffer,
          mimeType
        );
        if (!uploadResult.ok) {
          return await reply.fail('DOWNSTREAM_ERROR', uploadResult.error.message);
        }

        let thumbnailGcsPath: string | undefined;
        if (isImageMimeType(mimeType)) {
          const thumbnailResult = await services.thumbnailGenerator.generate(buffer);
          if (!thumbnailResult.ok) {
            return await reply.fail('DOWNSTREAM_ERROR', thumbnailResult.error.message);
          }

          const thumbnailUploadResult = await services.mediaStorage.uploadPrivateThumbnail(
            accountResult.value.userId,
            messageId,
            mediaId,
            'jpg',
            thumbnailResult.value.buffer,
            thumbnailResult.value.mimeType
          );
          if (!thumbnailUploadResult.ok) {
            return await reply.fail('DOWNSTREAM_ERROR', thumbnailUploadResult.error.message);
          }
          thumbnailGcsPath = thumbnailUploadResult.value.gcsPath;
        }

        return await reply.ok({
          media: {
            mxcUri: request.query.mxcUri,
            mimeType,
            fileName: request.query.fileName,
            sizeBytes: buffer.length,
            sha256: request.query.sha256,
            storageStatus: 'stored',
            gcsPath: uploadResult.value.gcsPath,
            ...(thumbnailGcsPath !== undefined ? { thumbnailGcsPath } : {}),
            storedMimeType: mimeType,
            storedSizeBytes: buffer.length,
            storedAt: new Date().toISOString(),
          },
        });
      }
    );

    fastify.get<{ Params: PrivateMediaParams }>(
      '/private/messages/:messageId/media',
      {
        schema: {
          operationId: 'getPrivateWhatsAppMessageMedia',
          summary: 'Get opaque access URL for private WhatsApp original media',
          tags: ['whatsapp'],
          params: {
            type: 'object',
            required: ['messageId'],
            properties: {
              messageId: { type: 'string', description: 'Private WhatsApp message ID' },
            },
          },
          response: {
            200: {
              description: 'Opaque private WhatsApp media access URL generated successfully',
              type: 'object',
              properties: {
                success: { type: 'boolean', const: true },
                data: {
                  type: 'object',
                  properties: {
                    url: { type: 'string' },
                    expiresAt: { type: 'string', format: 'date-time' },
                  },
                  required: ['url', 'expiresAt'],
                },
              },
              required: ['success', 'data'],
            },
            401: privateMediaErrorResponse('Unauthorized - invalid or missing token'),
            404: privateMediaErrorResponse('Private WhatsApp message not found or has no media'),
            500: privateMediaErrorResponse('Internal error'),
          },
        },
      },
      async (request: FastifyRequest<{ Params: PrivateMediaParams }>, reply) => {
        logIncomingRequest(request, {
          message: 'Received request to GET /whatsapp/private/messages/:messageId/media',
          includeParams: true,
          bodyPreviewLength: 0,
        });
        const user = await requireAuth(request, reply);
        if (user === null) {
          return;
        }
        const message = await getPrivateMessageForPublicUser(
          request.params.messageId,
          user.userId,
          reply
        );
        if (message === null || getPrivateImageMediaPath(message, 'original') === null) {
          if (message !== null) {
            await reply.fail('NOT_FOUND', 'Private WhatsApp message not found');
          }
          return;
        }

        const publicToken = createPublicPrivateMediaToken(
          message.id,
          'original',
          publicMediaTokenSecret
        );
        return await reply.ok({
          url: `/private/media-access?token=${publicToken.token}`,
          expiresAt: publicToken.expiresAt,
        });
      }
    );

    fastify.get<{ Params: PrivateMediaParams }>(
      '/private/messages/:messageId/thumbnail',
      {
        schema: {
          operationId: 'getPrivateWhatsAppMessageThumbnail',
          summary: 'Get opaque access URL for private WhatsApp thumbnail media',
          tags: ['whatsapp'],
          params: {
            type: 'object',
            required: ['messageId'],
            properties: {
              messageId: { type: 'string', description: 'Private WhatsApp message ID' },
            },
          },
          response: {
            200: {
              description: 'Opaque private WhatsApp thumbnail access URL generated successfully',
              type: 'object',
              properties: {
                success: { type: 'boolean', const: true },
                data: {
                  type: 'object',
                  properties: {
                    url: { type: 'string' },
                    expiresAt: { type: 'string', format: 'date-time' },
                  },
                  required: ['url', 'expiresAt'],
                },
              },
              required: ['success', 'data'],
            },
            401: privateMediaErrorResponse('Unauthorized - invalid or missing token'),
            404: privateMediaErrorResponse('Private WhatsApp message not found or has no thumbnail'),
            500: privateMediaErrorResponse('Internal error'),
          },
        },
      },
      async (request: FastifyRequest<{ Params: PrivateMediaParams }>, reply) => {
        logIncomingRequest(request, {
          message: 'Received request to GET /whatsapp/private/messages/:messageId/thumbnail',
          includeParams: true,
          bodyPreviewLength: 0,
        });
        const user = await requireAuth(request, reply);
        if (user === null) {
          return;
        }
        const message = await getPrivateMessageForPublicUser(
          request.params.messageId,
          user.userId,
          reply
        );
        if (message === null || getPrivateImageMediaPath(message, 'thumbnail') === null) {
          if (message !== null) {
            await reply.fail('NOT_FOUND', 'Private WhatsApp message not found');
          }
          return;
        }

        const publicToken = createPublicPrivateMediaToken(
          message.id,
          'thumbnail',
          publicMediaTokenSecret
        );
        return await reply.ok({
          url: `/private/media-access?token=${publicToken.token}`,
          expiresAt: publicToken.expiresAt,
        });
      }
    );

    fastify.get<{ Querystring: PrivateMediaAccessQuerystring }>(
      '/private/media-access',
      {
        schema: {
          operationId: 'accessPrivateWhatsAppMedia',
          summary: 'Access private WhatsApp media through an opaque token',
          tags: ['whatsapp'],
          querystring: {
            type: 'object',
            additionalProperties: false,
            properties: {
              token: { type: 'string', minLength: 1 },
            },
            required: ['token'],
          },
          response: {
            302: {
              description: 'Redirect to a short-lived storage signed URL',
              type: 'null',
            },
            404: privateMediaErrorResponse('Private WhatsApp media access token is invalid'),
            500: privateMediaErrorResponse('Internal error'),
            502: privateMediaErrorResponse('Downstream error'),
          },
        },
      },
      async (request: FastifyRequest<{ Querystring: PrivateMediaAccessQuerystring }>, reply) => {
        logIncomingRequest(request, {
          message: 'Received request to GET /whatsapp/private/media-access',
          bodyPreviewLength: 0,
        });

        const tokenPayload = parsePublicPrivateMediaToken(
          request.query.token,
          publicMediaTokenSecret
        );
        if (tokenPayload === null) {
          return await reply.fail('NOT_FOUND', 'Private WhatsApp media access token is invalid');
        }

        const messageResult = await getServices().privateWhatsAppRepository.getMessageById(
          tokenPayload.messageId
        );
        if (!messageResult.ok) {
          return await reply.fail('INTERNAL_ERROR', messageResult.error.message);
        }
        if (messageResult.value === null) {
          return await reply.fail('NOT_FOUND', 'Private WhatsApp message not found');
        }

        const signedUrlResult = await getSignedPrivateMediaUrlData(
          messageResult.value,
          tokenPayload.variant,
          false
        );
        if (!signedUrlResult.ok) {
          return await reply.fail(signedUrlResult.errorCode, signedUrlResult.message);
        }

        return await reply.redirect(String(signedUrlResult.data['url']));
      }
    );

    fastify.get<{
      Params: PrivateMediaParams;
      Querystring: InternalPrivateMediaQuerystring;
    }>(
      '/internal/whatsapp/private/messages/:messageId/media',
      {
        attachValidation: true,
        schema: {
          operationId: 'getInternalPrivateWhatsAppMessageMedia',
          summary: 'Get internal signed URL for private WhatsApp media processing',
          tags: ['internal'],
          params: {
            type: 'object',
            required: ['messageId'],
            properties: {
              messageId: { type: 'string', description: 'Private WhatsApp message ID' },
            },
          },
          querystring: {
            type: 'object',
            additionalProperties: false,
            properties: {
              sourceAccountId: { type: 'string', minLength: 1 },
              variant: { type: 'string', enum: ['original', 'thumbnail'], default: 'original' },
            },
            required: ['sourceAccountId'],
          },
          response: {
            200: {
              description: 'Internal private WhatsApp media signed URL generated successfully',
              type: 'object',
              properties: {
                success: { type: 'boolean', const: true },
                data: {
                  type: 'object',
                  properties: {
                    url: { type: 'string' },
                    expiresAt: { type: 'string', format: 'date-time' },
                    media: {
                      type: 'object',
                      properties: {
                        gcsPath: { type: 'string' },
                        mimeType: { type: 'string' },
                        sizeBytes: { type: 'number' },
                      },
                      required: ['gcsPath'],
                    },
                  },
                  required: ['url', 'expiresAt', 'media'],
                },
              },
              required: ['success', 'data'],
            },
            400: privateMediaErrorResponse('Invalid request'),
            401: privateMediaErrorResponse('Unauthorized'),
            404: privateMediaErrorResponse('Private WhatsApp message not found'),
            500: privateMediaErrorResponse('Internal error'),
            502: privateMediaErrorResponse('Downstream error'),
          },
        },
      },
      async (
        request: FastifyRequest<{
          Params: PrivateMediaParams;
          Querystring: InternalPrivateMediaQuerystring;
        }>,
        reply
      ) => {
        const variant = request.query.variant === 'thumbnail' ? 'thumbnail' : 'original';
        logIncomingRequest(request, {
          message: 'Received request to GET /internal/whatsapp/private/messages/:messageId/media',
          includeParams: true,
          bodyPreviewLength: 0,
          additionalFields: {
            route: 'internal_whatsapp_private_message_media_get',
            hasSourceAccountId: typeof request.query.sourceAccountId === 'string',
            variant,
          },
        });

        const authResult = validateInternalAuth(request);
        if (!authResult.valid) {
          return await reply.fail(
            'UNAUTHORIZED',
            'Internal auth failed for private WhatsApp media access'
          );
        }
        if ((request as ValidatedRequest).validationError !== undefined) {
          return await reply.fail('INVALID_REQUEST', 'Validation failed');
        }

        const messageResult = await getServices().privateWhatsAppRepository.getMessageById(
          request.params.messageId
        );
        if (!messageResult.ok) {
          return await reply.fail('INTERNAL_ERROR', messageResult.error.message);
        }
        if (messageResult.value?.sourceAccountId !== request.query.sourceAccountId) {
          return await reply.fail('NOT_FOUND', 'Private WhatsApp message not found');
        }

        return await replyWithSignedPrivateMediaUrl(reply, messageResult.value, variant, true);
      }
    );

  done();
};
