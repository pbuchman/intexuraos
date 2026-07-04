/**
 * JSON Schema definitions for webhook routes. Extracted out of
 * `webhookRoutes.ts` to keep route handlers focused on wiring + delegation.
 *
 * These schemas describe the public wire contract — they MUST stay in sync
 * with the webhook request/response types consumed by the orchestrator.
 */

export const taskCompleteWebhookSchema = {
  operationId: 'taskCompleteWebhook',
  summary: 'Task completion webhook from orchestrator',
  description: 'Internal webhook endpoint called by orchestrator when task completes. Requires HMAC signature.',
  tags: ['internal', 'webhooks'],
  body: {
    type: 'object',
    properties: {
      taskId: { type: 'string' },
      status: { type: 'string', enum: ['completed', 'failed', 'interrupted', 'cancelled'] },
      result: {
        type: 'object',
        properties: {
          prUrl: { type: 'string' },
          branch: { type: 'string' },
          commits: { type: 'number' },
          // --- Fields used in handler logic (strictly validated) ---
          comment_replied: { type: 'boolean' },
          planning_outcome_label: { type: 'string', enum: ['planned', 'unclear'] },
          planning_pr_url: { type: 'string' },
          planning_unclear_clarification: { type: 'string' },
          execution_linear_issue_url: { type: 'string' },
          // --- Pass-through fields (stored to Firestore, not acted on) ---
          summary: { type: 'string' },
          ciFailed: { type: 'boolean' },
          partialWork: { type: 'boolean' },
          rebaseResult: { type: 'string' },
          planning_superpowers_writing_plans_used: { type: 'string' },
          planning_linear_url: { type: 'string' },
          execution_outcome_label: { type: 'string' },
          execution_superpowers_subagent_driven_dev_used: { type: 'string' },
          execution_superpowers_requesting_code_review_used: { type: 'string' },
          execution_memory_ids_used: { type: 'string' },
          execution_memory_ids_rejected: { type: 'string' },
          execution_memory_usage_summary: { type: 'string' },
          review_id: { type: 'string' },
          review_comments_posted: { type: 'string' },
          review_types: { type: 'string' },
          requirements_tracker_updated: { type: 'string' },
          gh_actions_status: { type: 'string' },
          needs_remediation: { type: 'string' },
          requires_re_review: { type: 'string' },
          sentry_issue_url: { type: 'string' },
          sentry_linear_issue: { type: 'string' },
          sentry_outcome: { type: 'string', enum: ['fixed', 'suppressed'] },
          sentry_verification: { type: 'string' },
        },
        required: [],
      },
      error: {
        type: 'object',
        properties: {
          code: { type: 'string' },
          message: { type: 'string' },
          remediation: {
            type: 'object',
            properties: {
              action: { type: 'string', enum: ['retry', 'wait', 'fix_code', 'contact_support', 'retry_smaller'] },
              retryAfter: { type: 'number' },
              manualSteps: { type: 'string' },
              supportLink: { type: 'string' },
            },
            required: [],
          },
        },
        required: ['code', 'message'],
      },
      duration: { type: 'number' },
      resumedCompletion: { type: 'boolean' },
    },
    required: ['taskId', 'status'],
  },
  response: {
    200: {
      description: 'Webhook processed successfully',
      type: 'object',
      properties: { received: { type: 'boolean', enum: [true] } },
      required: ['received'],
    },
    401: {
      description: 'Invalid signature',
      type: 'object',
      properties: {
        success: { type: 'boolean', enum: [false] },
        error: {
          type: 'object',
          properties: { code: { type: 'string' }, message: { type: 'string' } },
          required: ['code', 'message'],
        },
      },
      required: ['success', 'error'],
    },
  },
} as const;

export const logChunkUploadSchema = {
  operationId: 'logChunkUpload',
  summary: 'Log chunk upload from orchestrator',
  description: 'Internal endpoint for uploading log chunks from orchestrator. Requires HMAC signature.',
  tags: ['internal', 'webhooks'],
  body: {
    type: 'object',
    properties: {
      taskId: { type: 'string' },
      chunks: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            sequence: { type: 'number' },
            content: { type: 'string', maxLength: 65536 },
            timestamp: { type: 'string' },
          },
          required: ['sequence', 'content', 'timestamp'],
        },
      },
    },
    required: ['taskId', 'chunks'],
  },
  response: {
    200: {
      description: 'Log chunks stored successfully',
      type: 'object',
      properties: {
        received: { type: 'boolean', enum: [true] },
        acknowledgedSequences: { type: 'array', items: { type: 'number' } },
        count: { type: 'number' },
      },
      required: ['received', 'acknowledgedSequences', 'count'],
    },
    401: {
      description: 'Invalid signature',
      type: 'object',
      properties: {
        success: { type: 'boolean', enum: [false] },
        error: {
          type: 'object',
          properties: { code: { type: 'string' }, message: { type: 'string' } },
          required: ['code', 'message'],
        },
      },
      required: ['success', 'error'],
    },
  },
} as const;

export const turnMetricsUploadSchema = {
  operationId: 'turnMetricsUpload',
  summary: 'Turn metrics upload from orchestrator',
  description: 'Internal endpoint for uploading turn-end metrics from orchestrator. Requires orchestrator HMAC signature.',
  tags: ['internal', 'webhooks'],
  body: {
    type: 'object',
    properties: {
      taskId: { type: 'string' },
      attempt: { type: 'number' },
      timestamp: { type: 'string' },
      cpuTimeSeconds: { type: 'number' },
      cpuCores: { type: 'number' },
      peakMemoryMB: { type: 'number' },
      wallTimeSeconds: { type: 'number' },
      apiWaitSeconds: { type: 'number' },
      toolExecSeconds: { type: 'number' },
      backgroundWaitSeconds: { type: 'number' },
      overheadSeconds: { type: 'number' },
      totalInputTokens: { type: 'number' },
      totalOutputTokens: { type: 'number' },
      totalCacheReadTokens: { type: 'number' },
      totalCacheCreationTokens: { type: 'number' },
      apiCallCount: { type: 'number' },
      cpuUtilizationPercent: { type: 'number' },
      idlePercent: { type: 'number' },
    },
    required: ['taskId', 'attempt', 'timestamp'],
  },
  response: {
    200: {
      description: 'Metrics stored successfully',
      type: 'object',
      properties: { received: { type: 'boolean', enum: [true] } },
      required: ['received'],
    },
  },
} as const;
