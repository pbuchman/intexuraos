import { createHash } from 'node:crypto';
import type { FastifyPluginCallback, FastifyRequest } from 'fastify';
import { logIncomingRequest, validateInternalAuth } from '@intexuraos/common-http';
import { getExtensionFromMimeType } from '../domain/whatsapp/utils/mimeType.js';
import { getServices } from '../services.js';

type ValidatedRequest = FastifyRequest & { validationError?: unknown };

interface PrivateMediaUploadQuerystring {
  sourceAccountId: string;
  matrixEventId: string;
  mxcUri: string;
  mediaId?: string;
  mimeType?: string;
  fileName?: string;
  sha256?: string;
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

function createPrivateWhatsAppMessageId(sourceAccountId: string, matrixEventId: string): string {
  return createHash('sha256').update(`${sourceAccountId}\0${matrixEventId}`).digest('hex');
}

export const privateMediaRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
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
                      'thumbnailGcsPath',
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
          400: {
            description: 'Invalid request',
            type: 'object',
            properties: {
              success: { type: 'boolean', const: false },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'error'],
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
          404: {
            description: 'Private WhatsApp account not found',
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
          502: {
            description: 'Downstream error',
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
      if (mimeType === undefined || !isImageMimeType(mimeType)) {
        return await reply.fail('INVALID_REQUEST', 'mimeType must be an image MIME type');
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

      return await reply.ok({
        media: {
          mxcUri: request.query.mxcUri,
          mimeType,
          fileName: request.query.fileName,
          sizeBytes: buffer.length,
          sha256: request.query.sha256,
          storageStatus: 'stored',
          gcsPath: uploadResult.value.gcsPath,
          thumbnailGcsPath: thumbnailUploadResult.value.gcsPath,
          storedMimeType: mimeType,
          storedSizeBytes: buffer.length,
          storedAt: new Date().toISOString(),
        },
      });
    }
  );

  done();
};
