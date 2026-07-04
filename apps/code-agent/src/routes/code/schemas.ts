/**
 * Shared JSON schema definitions for code routes.
 *
 * Extracted from codeRoutes.ts as part of INT-1430 route split.
 * These schemas are referenced by multiple resource route files.
 */
import { CODE_TASK_WORKER_TYPES } from '@intexuraos/code-task-domain';

const linearIssueForDisplaySchema = {
  type: 'object',
  properties: {
    identifier: { type: 'string' },
    parentIdentifier: { type: 'string', nullable: true },
    title: { type: 'string' },
    state: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        type: { type: 'string' },
      },
      required: ['name', 'type'],
    },
    priority: { type: 'number' },
    assignee: {
      type: 'object',
      nullable: true,
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
      },
    },
    labels: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
        },
        required: ['id', 'name'],
      },
    },
    url: { type: 'string' },
    commentCount: { type: 'number' },
    lastCommentAt: { type: 'string', nullable: true },
  },
  required: ['identifier', 'parentIdentifier', 'title', 'state', 'priority', 'assignee', 'labels', 'url', 'commentCount', 'lastCommentAt'],
} as const;

const workerTypeSchema = {
  type: 'string',
  enum: CODE_TASK_WORKER_TYPES,
} as const;

const executionMemoryContextSchema = {
  type: 'object',
  nullable: true,
  properties: {
    status: { type: 'string', enum: ['none', 'matched', 'error'] },
    applicationId: { type: 'string', nullable: true },
    retrievalVersion: { type: 'string', nullable: true },
    querySummary: { type: 'string', nullable: true },
    matchedAt: { type: 'string', format: 'date-time', nullable: true },
    matchedMemories: {
      type: 'array',
      nullable: true,
      items: {
        type: 'object',
        properties: {
          memoryId: { type: 'string' },
          title: { type: 'string' },
          memoryType: { type: 'string', enum: ['implementation_pattern', 'verification_pattern', 'pitfall_pattern', 'single_artifact_planning', 'decomposition_pattern', 'planning_decision', 'review_finding'] },
          score: { type: 'number' },
          appliesWhen: { type: 'string' },
          action: { type: 'string' },
          avoid: { type: 'string' },
          verification: { type: 'string' },
        },
        required: ['memoryId', 'title', 'memoryType', 'score', 'appliesWhen', 'action', 'avoid', 'verification'],
      },
    },
    topCandidates: {
      type: 'array',
      nullable: true,
      items: {
        type: 'object',
        properties: {
          memoryId: { type: 'string' },
          title: { type: 'string' },
          memoryType: { type: 'string', enum: ['implementation_pattern', 'verification_pattern', 'pitfall_pattern', 'single_artifact_planning', 'decomposition_pattern', 'planning_decision', 'review_finding'] },
          vectorScore: { type: 'number' },
          rerankScore: { type: 'number' },
          componentOverlap: { type: 'number' },
          effectiveness: { type: 'number' },
          passedThreshold: { type: 'boolean' },
        },
        required: ['memoryId', 'title', 'memoryType', 'vectorScore', 'rerankScore', 'componentOverlap', 'effectiveness', 'passedThreshold'],
      },
    },
    totalSearchResults: { type: 'number', nullable: true },
    errorCode: { type: 'string', nullable: true },
    errorMessage: { type: 'string', nullable: true },
  },
  required: ['status'],
} as const;

const executionMemoryPostRunSchema = {
  type: 'object',
  nullable: true,
  properties: {
    status: { type: 'string', enum: ['pending', 'processing', 'completed', 'skipped', 'error'] },
    attempts: { type: 'number' },
    lastAttemptAt: { type: 'string', format: 'date-time', nullable: true },
    generatedMemoryIds: { type: 'array', items: { type: 'string' } },
    evaluationSummary: { type: 'string', nullable: true },
    skipReason: { type: 'string', enum: ['infra_only', 'insufficient_signal', 'already_completed', 'no_reusable_lesson', 'planning_unclear'], nullable: true },
    errorMessage: { type: 'string', nullable: true },
    completedAt: { type: 'string', format: 'date-time', nullable: true },
  },
  required: ['status', 'attempts', 'generatedMemoryIds'],
} as const;

const dispatchStatusSchema = {
  type: 'object',
  nullable: true,
  properties: {
    state: { type: 'string', enum: ['waiting', 'blocked', 'terminal'] },
    reason: { type: 'string' },
    terminal: { type: 'boolean' },
    severity: { type: 'string', enum: ['info', 'warning', 'critical'] },
    message: { type: 'string' },
    remediation: { type: 'string' },
    workerNames: { type: 'array', items: { type: 'string' } },
    firstSeenAt: { type: 'string', format: 'date-time' },
    lastSeenAt: { type: 'string', format: 'date-time' },
    lastAttemptAt: { type: 'string', format: 'date-time', nullable: true },
    attemptCount: { type: 'number', nullable: true },
    expiresAt: { type: 'string', format: 'date-time', nullable: true },
    terminalCause: {
      type: 'object',
      nullable: true,
      properties: {
        reason: { type: 'string' },
        message: { type: 'string' },
        remediation: { type: 'string' },
        workerNames: { type: 'array', items: { type: 'string' } },
        lastSeenAt: { type: 'string', format: 'date-time' },
      },
      required: ['reason', 'message', 'remediation', 'workerNames', 'lastSeenAt'],
    },
    workerHealthDetails: {
      type: 'array',
      nullable: true,
      items: {
        type: 'object',
        properties: {
          workerName: { type: 'string' },
          tag: { type: 'string' },
          healthy: { type: 'boolean' },
          reason: { type: 'string', nullable: true },
          error: { type: 'string', nullable: true },
          code: { type: 'string', nullable: true },
          missingFields: { type: 'array', items: { type: 'string' }, nullable: true },
          contractMismatch: { type: 'boolean', nullable: true },
        },
        required: ['workerName', 'tag', 'healthy'],
      },
    },
    nextAction: {
      type: 'string',
      enum: ['will_retry_automatically', 'retry_after_fix', 'wait_until_scheduled', 'wait_for_active_task'],
    },
  },
  required: [
    'state',
    'reason',
    'terminal',
    'severity',
    'message',
    'remediation',
    'workerNames',
    'firstSeenAt',
    'lastSeenAt',
    'nextAction',
  ],
} as const;

const callbackStateSchema = {
  type: 'object',
  properties: {
    webhookUrl: { type: 'string' },
    callbackBaseUrl: { type: 'string' },
    owner: { type: 'string', enum: ['dev', 'prod', 'custom'] },
    configuredAt: { type: 'string', format: 'date-time' },
    lastSuccessAt: { type: 'string', format: 'date-time' },
    lastSuccessEndpoint: {
      type: 'string',
      enum: ['logs', 'task_event', 'task_complete', 'status', 'turn_metrics'],
    },
    lastFailure: {
      type: 'object',
      properties: {
        endpoint: {
          type: 'string',
          enum: ['logs', 'task_event', 'task_complete', 'status', 'turn_metrics'],
        },
        status: { type: 'number' },
        message: { type: 'string' },
        occurredAt: { type: 'string', format: 'date-time' },
      },
      required: ['endpoint', 'message', 'occurredAt'],
    },
  },
  required: ['webhookUrl', 'callbackBaseUrl', 'owner', 'configuredAt'],
} as const;

// Response schema for created task
const codeTaskSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    userId: { type: 'string' },
    prompt: { type: 'string' },
    sanitizedPrompt: { type: 'string' },
    systemPromptHash: { type: 'string' },
    workerType: workerTypeSchema,
    workerLocation: { type: 'string' },
    repository: { type: 'string' },
    baseBranch: { type: 'string' },
    traceId: { type: 'string' },
    status: {
      type: 'string',
      enum: ['dispatched', 'running', 'queued', 'planned', 'implemented', 'reviewed', 'failed', 'interrupted', 'cancelled', 'archived'],
    },
    dedupKey: { type: 'string' },
    callbackReceived: { type: 'boolean' },
    callbackState: callbackStateSchema,
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
    dispatchedAt: { type: 'string', format: 'date-time', nullable: true },
    linearIssueId: { type: 'string', nullable: true },
    linearIssue: {
      ...linearIssueForDisplaySchema,
      nullable: true,
    },
    agentType: { type: 'string', enum: ['planning', 'execution', 'pull_request', 'review', 'remediation', 'ask_agent', 'sentry'] },
    prNumber: { type: 'number', nullable: true },
    implementationTaskId: { type: 'string' },
    fanOutChildTaskIds: { type: 'array', items: { type: 'string' } },
    parentTaskId: { type: 'string' },
    followUpReason: { type: 'string' },
    result: {
      type: 'object',
      nullable: true,
      properties: {
        prUrl: { type: 'string', nullable: true },
        branch: { type: 'string' },
        commits: { type: 'number' },
        summary: { type: 'string' },
        ciFailed: { type: 'boolean', nullable: true },
        partialWork: { type: 'boolean', nullable: true },
        rebaseResult: { type: 'string', enum: ['success', 'conflict', 'skipped'], nullable: true },
        review_comments_posted: { type: 'string', nullable: true },
        review_types: { type: 'string', nullable: true },
        requirements_tracker_updated: { type: 'string', nullable: true },
        needs_remediation: { type: 'string', nullable: true },
        sentry_issue_url: { type: 'string', nullable: true },
        sentry_linear_issue: { type: 'string', nullable: true },
        sentry_outcome: { type: 'string', enum: ['fixed', 'suppressed'], nullable: true },
        sentry_verification: { type: 'string', nullable: true },
      },
    },
    error: {
      type: 'object',
      nullable: true,
      properties: {
            code: { type: 'string' },
            message: { type: 'string' },
            remediation: {
              type: 'object',
              nullable: true,
              properties: {
                action: { type: 'string', enum: ['retry', 'wait', 'fix_code', 'contact_support', 'retry_smaller'], nullable: true },
                retryAfter: { type: 'number', nullable: true },
                manualSteps: { type: 'string', nullable: true },
                supportLink: { type: 'string', nullable: true },
              },
            },
          },
        },
    dispatchStatus: dispatchStatusSchema,
    executionMemoryContext: executionMemoryContextSchema,
    executionMemoryPostRun: executionMemoryPostRunSchema,
  },
  required: [
    'id',
    'userId',
    'prompt',
    'sanitizedPrompt',
    'systemPromptHash',
    'workerType',
    'workerLocation',
    'repository',
    'baseBranch',
    'traceId',
    'status',
    'dedupKey',
    'callbackReceived',
    'createdAt',
    'updatedAt',
  ],
} as const;

export {
  linearIssueForDisplaySchema,
  workerTypeSchema,
  executionMemoryContextSchema,
  executionMemoryPostRunSchema,
  dispatchStatusSchema,
  callbackStateSchema,
  codeTaskSchema,
};
