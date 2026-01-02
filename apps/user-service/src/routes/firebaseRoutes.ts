/**
 * Firebase Authentication Routes
 *
 * POST /auth/firebase-token - Exchange Auth0 token for Firebase custom token
 */

import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { requireAuth } from '@intexuraos/common-http';
import { getAuth } from 'firebase-admin/auth';
import { getFirebaseAdmin } from '../infra/firebase/admin.js';

export const firebaseRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.post(
    '/auth/firebase-token',
    {
      schema: {
        operationId: 'getFirebaseToken',
        summary: 'Exchange Auth0 token for Firebase custom token',
        description:
          'Exchanges a valid Auth0 JWT for a Firebase custom token. ' +
          'The custom token can be used to authenticate with Firebase client SDK.',
        tags: ['auth'],
        response: {
          200: {
            description: 'Firebase custom token generated successfully',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                properties: {
                  customToken: { type: 'string', description: 'Firebase custom token' },
                },
                required: ['customToken'],
              },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'data'],
          },
          401: {
            description: 'Unauthorized - invalid or missing Auth0 token',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'error'],
          },
          500: {
            description: 'Internal server error - Firebase token generation failed',
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
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      try {
        getFirebaseAdmin();

        const customToken = await getAuth().createCustomToken(user.userId);

        request.log.info({ userId: user.userId }, 'Generated Firebase custom token');

        return await reply.ok({ customToken });
      } catch (error) {
        request.log.error(
          { error, userId: user.userId },
          'Failed to generate Firebase custom token'
        );
        return await reply.fail('INTERNAL_ERROR', 'Failed to generate Firebase custom token');
      }
    }
  );

  done();
};
