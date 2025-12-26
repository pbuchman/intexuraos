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

  // POST /v1/transcribe/:jobId/submit — Submit a pending job to Speechmatics
  fastify.post<{ Params: GetJobParams }>(
    '/v1/transcribe/:jobId/submit',
    {
      schema: {
        operationId: 'submitTranscriptionJob',
        summary: 'Submit a pending job to Speechmatics',
        description:
          'Submits a pending transcription job to Speechmatics for processing. ' +
          'The job must be in pending status. Returns the updated job with processing status.',
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
            description: 'Job submitted successfully',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: { $ref: 'TranscriptionJob#' },
            },
            required: ['success', 'data'],
          },
          400: {
            description: 'Job not in pending status',
            $ref: 'TranscriptionError#',
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
      const { jobRepository, speechmaticsClient, audioStorage } = getServices();

      // Get job
      const jobResult = await jobRepository.getById(jobId);

      if (!jobResult.ok) {
        return await reply.code(500).send({
          success: false,
          error: {
            code: 'INTERNAL_ERROR',
            message: jobResult.error.message,
          },
        });
      }

      if (jobResult.value === null) {
        return await reply.code(404).send({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: `Job ${jobId} not found`,
          },
        });
      }

      const job = jobResult.value;

      // Only submit pending jobs
      if (job.status !== 'pending') {
        return await reply.code(400).send({
          success: false,
          error: {
            code: 'INVALID_STATUS',
            message: `Job is in ${job.status} status, expected pending`,
          },
        });
      }

      // Generate signed URL for audio
      const signedUrlResult = await audioStorage.getSignedUrl(job.gcsPath, 3600);

      if (!signedUrlResult.ok) {
        // Update job with error
        await jobRepository.update(job.id, {
          status: 'failed',
          error: `Failed to generate audio URL: ${signedUrlResult.error.message}`,
          updatedAt: new Date().toISOString(),
        });

        return await reply.code(500).send({
          success: false,
          error: {
            code: 'SIGNED_URL_ERROR',
            message: signedUrlResult.error.message,
          },
        });
      }

      // Submit to Speechmatics
      const submitResult = await speechmaticsClient.createJob(signedUrlResult.value);

      if (!submitResult.ok) {
        // Update job with error
        await jobRepository.update(job.id, {
          status: 'failed',
          error: submitResult.error.message,
          updatedAt: new Date().toISOString(),
        });

        return await reply.code(500).send({
          success: false,
          error: {
            code: 'SPEECHMATICS_ERROR',
            message: submitResult.error.message,
          },
        });
      }

      // Update job to processing
      const nextPollAt = new Date(Date.now() + 5000).toISOString(); // 5 seconds initial poll
      const updateResult = await jobRepository.update(job.id, {
        status: 'processing',
        speechmaticsJobId: submitResult.value.id,
        nextPollAt,
        pollAttempts: 0,
        updatedAt: new Date().toISOString(),
      });

      if (!updateResult.ok) {
        return await reply.code(500).send({
          success: false,
          error: {
            code: 'INTERNAL_ERROR',
            message: updateResult.error.message,
          },
        });
      }

      // Get updated job
      const updatedJobResult = await jobRepository.getById(jobId);

      if (!updatedJobResult.ok || updatedJobResult.value === null) {
        return await reply.code(500).send({
          success: false,
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Failed to retrieve updated job',
          },
        });
      }

      fastify.log.info(
        { jobId: job.id, speechmaticsJobId: submitResult.value.id },
        'Job submitted to Speechmatics'
      );

      return await reply.code(200).send({
        success: true,
        data: updatedJobResult.value,
      });
    }
  );

  // POST /v1/transcribe/poll — Poll processing jobs for completion (called by Cloud Scheduler)
  fastify.post(
    '/v1/transcribe/poll',
    {
      schema: {
        operationId: 'pollTranscriptionJobs',
        summary: 'Poll processing jobs for completion',
        description:
          'Polls Speechmatics for status updates on processing jobs. ' +
          'Designed to be called by Cloud Scheduler every 30 seconds.',
        tags: ['transcription'],
        response: {
          200: {
            description: 'Poll cycle completed',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                properties: {
                  processedCount: {
                    type: 'integer',
                    description: 'Number of jobs polled',
                  },
                  completedCount: {
                    type: 'integer',
                    description: 'Number of jobs completed in this cycle',
                  },
                  failedCount: {
                    type: 'integer',
                    description: 'Number of jobs failed in this cycle',
                  },
                },
                required: ['processedCount', 'completedCount', 'failedCount'],
              },
            },
            required: ['success', 'data'],
          },
          500: {
            description: 'Internal error',
            $ref: 'TranscriptionError#',
          },
        },
      },
    },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const { jobRepository, speechmaticsClient, eventPublisher } = getServices();

      const jobsResult = await jobRepository.getJobsReadyToPoll(10);

      if (!jobsResult.ok) {
        return await reply.code(500).send({
          success: false,
          error: {
            code: 'INTERNAL_ERROR',
            message: jobsResult.error.message,
          },
        });
      }

      const jobs = jobsResult.value;
      let processedCount = 0;
      let completedCount = 0;
      let failedCount = 0;

      for (const job of jobs) {
        processedCount++;

        if (job.speechmaticsJobId === undefined) {
          fastify.log.error({ jobId: job.id }, 'Processing job missing Speechmatics job ID');
          continue;
        }

        const statusResult = await speechmaticsClient.getJobStatus(job.speechmaticsJobId);

        if (!statusResult.ok) {
          fastify.log.error(
            { jobId: job.id, error: statusResult.error.message },
            'Failed to get job status from Speechmatics'
          );

          // Calculate next poll with backoff
          const nextPollDelay = 5000 * Math.pow(2, job.pollAttempts + 1);
          const cappedDelay = Math.min(nextPollDelay, 3600000); // Max 1 hour
          const nextPollAt = new Date(Date.now() + cappedDelay).toISOString();

          await jobRepository.update(job.id, {
            pollAttempts: job.pollAttempts + 1,
            nextPollAt,
            updatedAt: new Date().toISOString(),
          });
          continue;
        }

        const status = statusResult.value;

        switch (status.status) {
          case 'done': {
            // Job completed successfully
            const now = new Date().toISOString();

            await jobRepository.update(job.id, {
              status: 'completed',
              transcript: status.transcript ?? '',
              completedAt: now,
              updatedAt: now,
            });

            // Publish completion event
            await eventPublisher.publishCompleted({
              type: 'srt.transcription.completed',
              jobId: job.id,
              messageId: job.messageId,
              mediaId: job.mediaId,
              userId: job.userId,
              status: 'completed',
              transcript: status.transcript ?? '',
              timestamp: now,
            });

            fastify.log.info(
              { jobId: job.id, speechmaticsJobId: job.speechmaticsJobId },
              'Job completed and event published'
            );
            completedCount++;
            break;
          }

          case 'rejected':
          case 'deleted': {
            // Job failed
            const now = new Date().toISOString();
            const errorMessage = status.error ?? `Job ${status.status}`;

            await jobRepository.update(job.id, {
              status: 'failed',
              error: errorMessage,
              completedAt: now,
              updatedAt: now,
            });

            // Publish failure event
            await eventPublisher.publishCompleted({
              type: 'srt.transcription.completed',
              jobId: job.id,
              messageId: job.messageId,
              mediaId: job.mediaId,
              userId: job.userId,
              status: 'failed',
              error: errorMessage,
              timestamp: now,
            });

            fastify.log.error(
              { jobId: job.id, speechmaticsJobId: job.speechmaticsJobId, error: errorMessage },
              'Job failed'
            );
            failedCount++;
            break;
          }

          case 'accepted':
          case 'running': {
            // Job still in progress, schedule next poll with backoff
            const nextPollDelay = 5000 * Math.pow(2, job.pollAttempts + 1);
            const cappedDelay = Math.min(nextPollDelay, 3600000);
            const nextPollAt = new Date(Date.now() + cappedDelay).toISOString();

            await jobRepository.update(job.id, {
              pollAttempts: job.pollAttempts + 1,
              nextPollAt,
              updatedAt: new Date().toISOString(),
            });
            break;
          }
        }
      }

      fastify.log.info({ processedCount, completedCount, failedCount }, 'Poll cycle completed');

      return await reply.code(200).send({
        success: true,
        data: {
          processedCount,
          completedCount,
          failedCount,
        },
      });
    }
  );

  done();
};
