/**
 * Transcription Routes.
 * Handles job creation and status queries.
 */
import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { getServices } from '../../services.js';

/**
 * Request body for POST /v1/transcribe.
 */
interface CreateJobBody {
  messageId: string;
  mediaId: string;
  userId: string;
  gcsPath: string;
  mimeType: string;
}

/**
 * Route params for GET /v1/transcribe/:jobId.
 */
interface GetJobParams {
  jobId: string;
}

/**
 * Transcribe routes plugin.
 */
export const transcribeRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  // Register shared schemas
  fastify.addSchema({
    $id: 'TranscriptionJob',
    type: 'object',
    required: ['id', 'messageId', 'mediaId', 'userId', 'status', 'createdAt', 'updatedAt'],
    properties: {
      id: { type: 'string', description: 'Internal job ID (UUID)' },
      messageId: { type: 'string', description: 'WhatsApp message ID' },
      mediaId: { type: 'string', description: 'WhatsApp media ID' },
      userId: { type: 'string', description: 'IntexuraOS user ID' },
      gcsPath: { type: 'string', description: 'GCS path to audio file' },
      mimeType: { type: 'string', description: 'Audio MIME type' },
      status: {
        type: 'string',
        enum: ['pending', 'processing', 'completed', 'failed'],
        description: 'Job status',
      },
      speechmaticsJobId: { type: 'string', description: 'Speechmatics external job ID' },
      transcript: { type: 'string', description: 'Transcription result' },
      error: { type: 'string', description: 'Error message' },
      pollAttempts: { type: 'integer', description: 'Number of poll attempts' },
      nextPollAt: { type: 'string', format: 'date-time', description: 'Next poll time' },
      createdAt: { type: 'string', format: 'date-time', description: 'Creation timestamp' },
      updatedAt: { type: 'string', format: 'date-time', description: 'Last update timestamp' },
      completedAt: { type: 'string', format: 'date-time', description: 'Completion timestamp' },
    },
  });

  fastify.addSchema({
    $id: 'TranscriptionError',
    type: 'object',
    required: ['success', 'error'],
    properties: {
      success: { type: 'boolean', enum: [false] },
      error: {
        type: 'object',
        required: ['code', 'message'],
        properties: {
          code: { type: 'string' },
          message: { type: 'string' },
        },
      },
    },
  });

  // POST /v1/transcribe — Create transcription job
  fastify.post<{ Body: CreateJobBody }>(
    '/v1/transcribe',
    {
      schema: {
        operationId: 'createTranscriptionJob',
        summary: 'Create a transcription job',
        description:
          'Creates a new transcription job for an audio file. Idempotent: returns existing job if one exists for the same messageId/mediaId.',
        tags: ['transcription'],
        body: {
          type: 'object',
          required: ['messageId', 'mediaId', 'userId', 'gcsPath', 'mimeType'],
          properties: {
            messageId: { type: 'string', description: 'WhatsApp message ID' },
            mediaId: { type: 'string', description: 'WhatsApp media ID' },
            userId: { type: 'string', description: 'IntexuraOS user ID' },
            gcsPath: { type: 'string', description: 'GCS path to audio file' },
            mimeType: { type: 'string', description: 'Audio MIME type' },
          },
        },
        response: {
          200: {
            description: 'Job already exists (idempotent return)',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: { $ref: 'TranscriptionJob#' },
            },
            required: ['success', 'data'],
          },
          201: {
            description: 'Job created successfully',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: { $ref: 'TranscriptionJob#' },
            },
            required: ['success', 'data'],
          },
          400: {
            description: 'Invalid request',
            $ref: 'TranscriptionError#',
          },
          500: {
            description: 'Internal error',
            $ref: 'TranscriptionError#',
          },
        },
      },
    },
    async (request: FastifyRequest<{ Body: CreateJobBody }>, reply: FastifyReply) => {
      const { messageId, mediaId, userId, gcsPath, mimeType } = request.body;
      const { jobRepository } = getServices();

      // Idempotency check: return existing job if one exists
      const existingResult = await jobRepository.findByMediaKey(messageId, mediaId);

      if (!existingResult.ok) {
        return await reply.code(500).send({
          success: false,
          error: {
            code: 'INTERNAL_ERROR',
            message: existingResult.error.message,
          },
        });
      }

      if (existingResult.value !== null) {
        // Job already exists, return it (idempotent)
        return await reply.code(200).send({
          success: true,
          data: existingResult.value,
        });
      }

      // Create new job
      const now = new Date().toISOString();
      const createResult = await jobRepository.create({
        messageId,
        mediaId,
        userId,
        gcsPath,
        mimeType,
        status: 'pending',
        pollAttempts: 0,
        createdAt: now,
        updatedAt: now,
      });

      if (!createResult.ok) {
        return await reply.code(500).send({
          success: false,
          error: {
            code: 'INTERNAL_ERROR',
            message: createResult.error.message,
          },
        });
      }

      return await reply.code(201).send({
        success: true,
        data: createResult.value,
      });
    }
  );

  // GET /v1/transcribe/:jobId — Get job status
  fastify.get<{ Params: GetJobParams }>(
    '/v1/transcribe/:jobId',
    {
      schema: {
        operationId: 'getTranscriptionJob',
        summary: 'Get transcription job status',
        description: 'Retrieves the current status and details of a transcription job.',
        tags: ['transcription'],
        params: {
          type: 'object',
          required: ['jobId'],
          properties: {
            jobId: { type: 'string', description: 'Internal job ID' },
          },
        },
        response: {
          200: {
            description: 'Job found',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: { $ref: 'TranscriptionJob#' },
            },
            required: ['success', 'data'],
          },
          404: {
            description: 'Job not found',
            $ref: 'TranscriptionError#',
          },
          500: {
            description: 'Internal error',
            $ref: 'TranscriptionError#',
          },
        },
      },
    },
    async (request: FastifyRequest<{ Params: GetJobParams }>, reply: FastifyReply) => {
      const { jobId } = request.params;
      const { jobRepository } = getServices();

      const result = await jobRepository.getById(jobId);

      if (!result.ok) {
        return await reply.code(500).send({
          success: false,
          error: {
            code: 'INTERNAL_ERROR',
            message: result.error.message,
          },
        });
      }

      if (result.value === null) {
        return await reply.code(404).send({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: `Job ${jobId} not found`,
          },
        });
      }

      return await reply.code(200).send({
        success: true,
        data: result.value,
      });
    }
  );

  done();
};
