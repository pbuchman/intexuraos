/**
 * Compliance-report webhook route handler.
 *
 * Receives Agent Compliance Reports from the orchestrator and stores them
 * in the code_tasks/{taskId}/compliance_reports subcollection.
 *
 * Auth: X-Internal-Auth + HMAC-SHA256 per-task webhook signature.
 */

import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { logIncomingRequest, validateInternalAuth } from '@intexuraos/common-http';
import { getServices } from '../../services.js';
import { validateWebhookSignature } from '../../infra/webhookValidation.js';

// ---------------------------------------------------------------------------
// Request types
// ---------------------------------------------------------------------------

interface ComplianceReportWebhookBody {
  taskId: string;
  prNumber: number;
  report: {
    claimVerification: {
      ciTrackedCalled: { called: boolean; exitCode: number | null; msgRef: string | null };
      prCreated: { created: boolean; url: string | null; msgRef: string | null };
      commitCount: number;
      summaryAccurate: boolean;
      summaryContradictions: string[];
    };
    contractCompliance: {
      subagentDrivenDevInvoked: { invoked: boolean; msgRef: string | null };
      requestingCodeReviewInvoked: { invoked: boolean; msgRef: string | null };
      codeReviewerDispatched: { dispatched: boolean; msgRef: string | null };
      correctOrder: boolean;
      skillViolations: string[];
    };
    anomalies: {
      type: string;
      severity: string;
      msgRef: string;
      description: string;
    }[];
    executionMetrics: {
      totalMessages: number;
      hookViolationCount: number;
      toolErrorCount: number;
      subagentDispatchCount: number;
    };
  };
  model: string;
  promptVersion: string;
  costUsd: number;
  workerType: string;
  transcriptTooLong: boolean;
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export const complianceReportRoute: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.post<{ Body: ComplianceReportWebhookBody }>(
    '/internal/webhooks/compliance-report',
    {
      schema: {
        operationId: 'complianceReportWebhook',
        tags: ['webhooks'],
        body: {
          type: 'object',
          properties: {
            taskId: { type: 'string' },
            prNumber: { type: 'number' },
            report: {
              type: 'object',
              properties: {
                claimVerification: {
                  type: 'object',
                  properties: {
                    ciTrackedCalled: {
                      type: 'object',
                      properties: {
                        called: { type: 'boolean' },
                        exitCode: { type: ['number', 'null'] },
                        msgRef: { type: ['string', 'null'] },
                      },
                    },
                    prCreated: {
                      type: 'object',
                      properties: {
                        created: { type: 'boolean' },
                        url: { type: ['string', 'null'] },
                        msgRef: { type: ['string', 'null'] },
                      },
                    },
                    commitCount: { type: 'number' },
                    summaryAccurate: { type: 'boolean' },
                    summaryContradictions: { type: 'array', items: { type: 'string' } },
                  },
                },
                contractCompliance: {
                  type: 'object',
                  properties: {
                    subagentDrivenDevInvoked: {
                      type: 'object',
                      properties: {
                        invoked: { type: 'boolean' },
                        msgRef: { type: ['string', 'null'] },
                      },
                    },
                    requestingCodeReviewInvoked: {
                      type: 'object',
                      properties: {
                        invoked: { type: 'boolean' },
                        msgRef: { type: ['string', 'null'] },
                      },
                    },
                    codeReviewerDispatched: {
                      type: 'object',
                      properties: {
                        dispatched: { type: 'boolean' },
                        msgRef: { type: ['string', 'null'] },
                      },
                    },
                    correctOrder: { type: 'boolean' },
                    skillViolations: { type: 'array', items: { type: 'string' } },
                  },
                },
                anomalies: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      type: { type: 'string' },
                      severity: { type: 'string' },
                      msgRef: { type: 'string' },
                      description: { type: 'string' },
                    },
                  },
                },
                executionMetrics: {
                  type: 'object',
                  properties: {
                    totalMessages: { type: 'number' },
                    hookViolationCount: { type: 'number' },
                    toolErrorCount: { type: 'number' },
                    subagentDispatchCount: { type: 'number' },
                  },
                },
              },
            },
            model: { type: 'string' },
            promptVersion: { type: 'string' },
            costUsd: { type: 'number' },
            workerType: { type: 'string' },
            transcriptTooLong: { type: 'boolean' },
          },
          required: ['taskId', 'prNumber', 'report', 'model', 'promptVersion', 'costUsd', 'workerType', 'transcriptTooLong'],
        },
      },
    },
    async (request: FastifyRequest<{ Body: ComplianceReportWebhookBody }>, reply: FastifyReply) => {
      logIncomingRequest(request, {
        message: 'Received request to POST /internal/webhooks/compliance-report',
      });

      // Step 1: Validate internal auth
      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        request.log.warn({ reason: authResult.reason }, 'Internal auth failed for compliance-report webhook');
        return await reply.fail('UNAUTHORIZED', 'Internal authentication failed');
      }

      // Step 2: Validate HMAC signature (per-task secret)
      const signatureResult = await validateWebhookSignature(request, {
        getWebhookSecret: async (taskId) => {
          const { codeTaskRepo } = getServices();
          const taskResult = await codeTaskRepo.findById(taskId);
          if (!taskResult.ok) return null;
          return taskResult.value.webhookSecret ?? null;
        },
      });

      if (!signatureResult.ok) {
        request.log.warn({ error: signatureResult.error }, 'Webhook signature validation failed for compliance-report');
        return await reply.fail('UNAUTHORIZED', 'Unauthorized');
      }

      // Step 3: Store in Firestore subcollection
      const { taskId, ...rest } = request.body;
      const { firestore, logger } = getServices();

      try {
        await firestore
          .collection('code_tasks')
          .doc(taskId)
          .collection('compliance_reports')
          .add({
            taskId,
            ...rest,
            createdAt: new Date(),
          });
      } catch (error: unknown) {
        logger.error({ taskId, error }, 'Failed to store compliance report');
        return await reply.fail('INTERNAL_ERROR', 'Failed to store compliance report');
      }

      request.log.info({ taskId }, 'Compliance report stored');

      // @allow-raw-send: orchestrator contract requires simple acknowledgment
      return await reply.send({ success: true });
    }
  );

  done();
};
