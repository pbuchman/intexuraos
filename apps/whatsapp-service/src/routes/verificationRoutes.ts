/**
 * WhatsApp Phone Verification Routes
 *
 * POST /whatsapp/verify/send     - Send verification code
 * POST /whatsapp/verify/confirm  - Verify code
 * GET  /whatsapp/verify/status/:phone - Check verification status
 */

import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { logIncomingRequest, requireAuth } from '@intexuraos/common-http';
import { randomInt } from 'node:crypto';
import { getServices } from '../services.js';
import { normalizePhoneNumber, validatePhoneNumber } from './shared.js';

const VERIFICATION_CODE_LENGTH = 6;
const VERIFICATION_TTL_SECONDS = 600; // 10 minutes
const MAX_VERIFICATION_ATTEMPTS = 3;
const RATE_LIMIT_WINDOW_MS = 3600000; // 1 hour
const MAX_REQUESTS_PER_HOUR = 3;
const RESEND_COOLDOWN_SECONDS = 60;

function generateVerificationCode(): string {
  const max = 10 ** VERIFICATION_CODE_LENGTH - 1;
  const min = 10 ** (VERIFICATION_CODE_LENGTH - 1);
  const code = randomInt(min, max + 1);
  return String(code);
}

const sendRequestSchema = z.object({
  phoneNumber: z.string().min(1, 'Phone number is required'),
});

const confirmRequestSchema = z.object({
  verificationId: z.string().min(1, 'Verification ID is required'),
  code: z.string().length(VERIFICATION_CODE_LENGTH, `Code must be ${String(VERIFICATION_CODE_LENGTH)} digits`),
});

type SendRequest = z.infer<typeof sendRequestSchema>;
type ConfirmRequest = z.infer<typeof confirmRequestSchema>;

export const verificationRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  // POST /whatsapp/verify/send - Send verification code
  fastify.post<{ Body: SendRequest }>(
    '/whatsapp/verify/send',
    {
      schema: {
        operationId: 'sendVerificationCode',
        summary: 'Send verification code',
        description:
          'Send a 6-digit verification code to the specified phone number via WhatsApp. ' +
          'Rate limited to 3 requests per phone per hour with 60-second cooldown between requests.',
        tags: ['whatsapp', 'verification'],
        body: {
          type: 'object',
          required: ['phoneNumber'],
          properties: {
            phoneNumber: {
              type: 'string',
              description: 'Phone number to verify (E.164 format with +)',
            },
          },
        },
        response: {
          200: {
            description: 'Verification code sent successfully',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                properties: {
                  verificationId: { type: 'string' },
                  expiresAt: { type: 'number', description: 'Unix timestamp when code expires' },
                  cooldownUntil: {
                    type: 'number',
                    description: 'Unix timestamp when next request is allowed',
                  },
                },
                required: ['verificationId', 'expiresAt'],
              },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'data'],
          },
          400: {
            description: 'Invalid request',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'error'],
          },
          409: {
            description: 'Phone already verified or pending',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'error'],
          },
          429: {
            description: 'Rate limit exceeded',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'error'],
          },
          502: {
            description: 'Downstream error',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'error'],
          },
        },
      },
    },
    async (request: FastifyRequest<{ Body: SendRequest }>, reply: FastifyReply) => {
      logIncomingRequest(request, {
        message: 'Received request to POST /whatsapp/verify/send',
        bodyPreviewLength: 200,
      });

      const user = await requireAuth(request, reply);
      if (!user) {
        return;
      }

      const parseResult = sendRequestSchema.safeParse(request.body);
      /* v8 ignore start - defense-in-depth: Fastify schema validates first */
      if (!parseResult.success) {
        const errors = parseResult.error.errors.map((e) => ({
          path: e.path.join('.'),
          message: e.message,
        }));
        return await reply.fail('INVALID_REQUEST', 'Validation failed', undefined, { errors });
      }
      /* v8 ignore stop */

      const { phoneNumber } = parseResult.data;
      const validation = validatePhoneNumber(phoneNumber);
      if (!validation.valid) {
        return await reply.fail('INVALID_REQUEST', validation.error, undefined, {
          phoneNumber,
        });
      }

      const normalizedPhone = validation.normalized;
      const { phoneVerificationRepository, messageSender } = getServices();

      // Generate code and calculate expiry
      const code = generateVerificationCode();
      const now = new Date();
      const expiresAt = Math.floor(now.getTime() / 1000) + VERIFICATION_TTL_SECONDS;
      const windowStartTime = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();

      // Atomically check all constraints and create verification record
      const createResult = await phoneVerificationRepository.createWithChecks({
        userId: user.userId,
        phoneNumber: normalizedPhone,
        code,
        expiresAt,
        cooldownSeconds: RESEND_COOLDOWN_SECONDS,
        maxRequestsPerHour: MAX_REQUESTS_PER_HOUR,
        windowStartTime,
      });

      if (!createResult.ok) {
        const error = createResult.error;
        if (error.code === 'ALREADY_VERIFIED') {
          return await reply.fail('CONFLICT', 'Phone number already verified', undefined, {
            phoneNumber: normalizedPhone,
            alreadyVerified: true,
          });
        }
        if (error.code === 'COOLDOWN_ACTIVE') {
          const details = error.details as { cooldownUntil?: number; existingPendingId?: string } | undefined;
          return await reply.fail('RATE_LIMITED', 'Please wait before requesting another code', undefined, {
            cooldownUntil: details?.cooldownUntil,
            existingVerificationId: details?.existingPendingId,
          });
        }
        if (error.code === 'RATE_LIMIT_EXCEEDED') {
          return await reply.fail('RATE_LIMITED', 'Too many verification requests. Try again later.', undefined, {
            maxRequests: MAX_REQUESTS_PER_HOUR,
            windowHours: 1,
          });
        }
        return await reply.fail('DOWNSTREAM_ERROR', error.message);
      }

      const { verification, cooldownUntil } = createResult.value;

      // Send verification code via WhatsApp (outside transaction - idempotent)
      const verificationMessage =
        `Your IntexuraOS verification code is: ${code}\n\n` +
        `This code expires in ${String(VERIFICATION_TTL_SECONDS / 60)} minutes.`;

      const sendResult = await messageSender.sendTextMessage(
        `+${normalizedPhone}`,
        verificationMessage
      );

      if (!sendResult.ok) {
        // Mark verification as expired since we couldn't send the code
        await phoneVerificationRepository.updateStatus(verification.id, 'expired');
        return await reply.fail('DOWNSTREAM_ERROR', 'Failed to send verification code', undefined, {
          reason: sendResult.error.message,
        });
      }

      return await reply.ok({
        verificationId: verification.id,
        expiresAt,
        cooldownUntil,
      });
    }
  );

  // POST /whatsapp/verify/confirm - Verify code
  fastify.post<{ Body: ConfirmRequest }>(
    '/whatsapp/verify/confirm',
    {
      schema: {
        operationId: 'confirmVerificationCode',
        summary: 'Confirm verification code',
        description:
          'Verify the 6-digit code sent to the phone number. ' +
          'Maximum 3 attempts allowed before verification is locked.',
        tags: ['whatsapp', 'verification'],
        body: {
          type: 'object',
          required: ['verificationId', 'code'],
          properties: {
            verificationId: { type: 'string', description: 'Verification ID from send response' },
            code: {
              type: 'string',
              pattern: '^[0-9]{6}$',
              description: '6-digit verification code',
            },
          },
        },
        response: {
          200: {
            description: 'Phone number verified successfully',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                properties: {
                  phoneNumber: { type: 'string' },
                  verified: { type: 'boolean', enum: [true] },
                  verifiedAt: { type: 'string', format: 'date-time' },
                },
                required: ['phoneNumber', 'verified', 'verifiedAt'],
              },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'data'],
          },
          400: {
            description: 'Invalid code',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'error'],
          },
          404: {
            description: 'Verification not found',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'error'],
          },
          410: {
            description: 'Verification expired',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'error'],
          },
          423: {
            description: 'Maximum attempts exceeded',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'error'],
          },
          502: {
            description: 'Downstream error',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'error'],
          },
        },
      },
    },
    async (request: FastifyRequest<{ Body: ConfirmRequest }>, reply: FastifyReply) => {
      logIncomingRequest(request, {
        message: 'Received request to POST /whatsapp/verify/confirm',
        bodyPreviewLength: 200,
      });

      const user = await requireAuth(request, reply);
      if (!user) {
        return;
      }

      const parseResult = confirmRequestSchema.safeParse(request.body);
      /* v8 ignore start - defense-in-depth: Fastify schema validates first */
      if (!parseResult.success) {
        const errors = parseResult.error.errors.map((e) => ({
          path: e.path.join('.'),
          message: e.message,
        }));
        return await reply.fail('INVALID_REQUEST', 'Validation failed', undefined, { errors });
      }
      /* v8 ignore stop */

      const { verificationId, code } = parseResult.data;
      const { phoneVerificationRepository } = getServices();

      const findResult = await phoneVerificationRepository.findById(verificationId);
      if (!findResult.ok) {
        return await reply.fail('DOWNSTREAM_ERROR', findResult.error.message);
      }

      const verification = findResult.value;
      if (verification === null) {
        return await reply.fail('NOT_FOUND', 'Verification not found');
      }

      // Verify ownership
      if (verification.userId !== user.userId) {
        return await reply.fail('NOT_FOUND', 'Verification not found');
      }

      // Check status
      if (verification.status === 'verified') {
        return await reply.fail('CONFLICT', 'Phone number already verified', undefined, {
          phoneNumber: verification.phoneNumber,
        });
      }

      if (verification.status === 'max_attempts') {
        return await reply.fail('LOCKED', 'Maximum verification attempts exceeded. Request a new code.');
      }

      if (verification.status === 'expired') {
        return await reply.fail('GONE', 'Verification code has expired. Request a new code.');
      }

      // Check expiry
      const now = Math.floor(Date.now() / 1000);
      if (verification.expiresAt <= now) {
        await phoneVerificationRepository.updateStatus(verificationId, 'expired');
        return await reply.fail('GONE', 'Verification code has expired. Request a new code.');
      }

      // Check attempts
      if (verification.attempts >= MAX_VERIFICATION_ATTEMPTS) {
        await phoneVerificationRepository.updateStatus(verificationId, 'max_attempts', {
          lastAttemptAt: new Date().toISOString(),
        });
        return await reply.fail('LOCKED', 'Maximum verification attempts exceeded. Request a new code.');
      }

      // Verify code
      if (verification.code !== code) {
        const incrementResult = await phoneVerificationRepository.incrementAttempts(verificationId);
        if (!incrementResult.ok) {
          return await reply.fail('DOWNSTREAM_ERROR', incrementResult.error.message);
        }

        const remainingAttempts = MAX_VERIFICATION_ATTEMPTS - incrementResult.value.attempts;
        if (remainingAttempts <= 0) {
          await phoneVerificationRepository.updateStatus(verificationId, 'max_attempts', {
            lastAttemptAt: new Date().toISOString(),
          });
          return await reply.fail('LOCKED', 'Maximum verification attempts exceeded. Request a new code.');
        }

        return await reply.fail('INVALID_REQUEST', 'Invalid verification code', undefined, {
          remainingAttempts,
        });
      }

      // Code is correct - mark as verified
      const verifiedAt = new Date().toISOString();
      const updateResult = await phoneVerificationRepository.updateStatus(verificationId, 'verified', {
        verifiedAt,
      });

      if (!updateResult.ok) {
        return await reply.fail('DOWNSTREAM_ERROR', updateResult.error.message);
      }

      return await reply.ok({
        phoneNumber: verification.phoneNumber,
        verified: true,
        verifiedAt,
      });
    }
  );

  // GET /whatsapp/verify/status/:phone - Check verification status
  fastify.get<{ Params: { phone: string } }>(
    '/whatsapp/verify/status/:phone',
    {
      schema: {
        operationId: 'getVerificationStatus',
        summary: 'Get verification status',
        description: 'Check if a phone number has been verified for the authenticated user.',
        tags: ['whatsapp', 'verification'],
        params: {
          type: 'object',
          required: ['phone'],
          properties: {
            phone: {
              type: 'string',
              description: 'Phone number to check (digits only, no + prefix)',
            },
          },
        },
        response: {
          200: {
            description: 'Verification status retrieved',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                properties: {
                  phoneNumber: { type: 'string' },
                  verified: { type: 'boolean' },
                  pendingVerification: {
                    type: 'object',
                    nullable: true,
                    properties: {
                      id: { type: 'string' },
                      expiresAt: { type: 'number' },
                      attemptsRemaining: { type: 'number' },
                    },
                  },
                },
                required: ['phoneNumber', 'verified'],
              },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'data'],
          },
          400: {
            description: 'Invalid phone number',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'error'],
          },
          502: {
            description: 'Downstream error',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'error'],
          },
        },
      },
    },
    async (request: FastifyRequest<{ Params: { phone: string } }>, reply: FastifyReply) => {
      logIncomingRequest(request, {
        message: 'Received request to GET /whatsapp/verify/status/:phone',
      });

      const user = await requireAuth(request, reply);
      if (!user) {
        return;
      }

      const { phone } = request.params;
      const normalizedPhone = normalizePhoneNumber(phone);

      if (normalizedPhone.length === 0) {
        return await reply.fail('INVALID_REQUEST', 'Phone number is required');
      }

      const { phoneVerificationRepository } = getServices();

      // Check if verified
      const verifiedResult = await phoneVerificationRepository.isPhoneVerified(
        user.userId,
        normalizedPhone
      );
      if (!verifiedResult.ok) {
        return await reply.fail('DOWNSTREAM_ERROR', verifiedResult.error.message);
      }

      if (verifiedResult.value) {
        return await reply.ok({
          phoneNumber: normalizedPhone,
          verified: true,
          pendingVerification: null,
        });
      }

      // Check for pending verification
      const pendingResult = await phoneVerificationRepository.findPendingByUserAndPhone(
        user.userId,
        normalizedPhone
      );
      if (!pendingResult.ok) {
        return await reply.fail('DOWNSTREAM_ERROR', pendingResult.error.message);
      }

      const pending = pendingResult.value;
      if (pending !== null) {
        return await reply.ok({
          phoneNumber: normalizedPhone,
          verified: false,
          pendingVerification: {
            id: pending.id,
            expiresAt: pending.expiresAt,
            attemptsRemaining: MAX_VERIFICATION_ATTEMPTS - pending.attempts,
          },
        });
      }

      return await reply.ok({
        phoneNumber: normalizedPhone,
        verified: false,
        pendingVerification: null,
      });
    }
  );

  done();
};
