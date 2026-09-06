/**
 * Shared JSON schemas for `internal/*` routes.
 *
 * Extracted from `routes/internalRoutes.ts` (INT-1433) so the individual
 * handler files stay readable. Each schema here is consumed verbatim by
 * Fastify — do NOT alter the shape without auditing every route that uses it.
 */

// ---------------------------------------------------------------------------
// Shared error response envelopes
// ---------------------------------------------------------------------------

export const UNAUTHORIZED_RESPONSE_SCHEMA = {
  description: 'Unauthorized',
  type: 'object',
  properties: {
    success: { type: 'boolean', enum: [false] },
    error: {
      type: 'object',
      properties: {
        code: { type: 'string', enum: ['UNAUTHORIZED'] },
        message: { type: 'string' },
      },
      required: ['code', 'message'],
    },
  },
  required: ['success', 'error'],
} as const;

/**
 * Build a NOT_FOUND response envelope with an endpoint-specific description.
 * All other fields are identical across callers — only the OpenAPI doc string
 * varies so the generated schema reads naturally per endpoint.
 */
export const notFoundResponseSchema = <D extends string>(description: D) => ({
  description,
  type: 'object',
  properties: {
    success: { type: 'boolean', enum: [false] },
    error: {
      type: 'object',
      properties: {
        code: { type: 'string', enum: ['NOT_FOUND'] },
        message: { type: 'string' },
      },
      required: ['code', 'message'],
    },
  },
  required: ['success', 'error'],
}) as const;

export const INTERNAL_ERROR_RESPONSE_SCHEMA = {
  description: 'Internal server error',
  type: 'object',
  properties: {
    success: { type: 'boolean', enum: [false] },
    error: {
      type: 'object',
      properties: {
        code: { type: 'string', enum: ['INTERNAL_ERROR'] },
        message: { type: 'string' },
      },
      required: ['code', 'message'],
    },
  },
  required: ['success', 'error'],
} as const;

export const DOWNSTREAM_ERROR_RESPONSE_SCHEMA = {
  description: 'Upstream service error',
  type: 'object',
  properties: {
    success: { type: 'boolean', enum: [false] },
    error: {
      type: 'object',
      properties: {
        code: { type: 'string', enum: ['DOWNSTREAM_ERROR'] },
        message: { type: 'string' },
      },
      required: ['code', 'message'],
    },
  },
  required: ['success', 'error'],
} as const;

// ---------------------------------------------------------------------------
// Cleanup endpoints
// ---------------------------------------------------------------------------

export const RECONCILE_MERGE_CONFLICTS_SCHEMA = {
  operationId: 'reconcileMergeConflicts',
  summary: 'Sync Firestore PR state from GitHub',
  description:
    'Called by Cloud Scheduler every minute. Syncs open/closed state and refreshes mergeConflictStatus for open PRs from GitHub into Firestore.',
  tags: ['internal'],
  response: {
    200: {
      description: 'Reconcile completed',
      type: 'object',
      additionalProperties: false,
      properties: {
        processed: { type: 'number' },
        closed: { type: 'number' },
        reopened: { type: 'number' },
        mergeConflictRefreshed: { type: 'number' },
        skipped: { type: 'number' },
        error: { type: 'number' },
      },
      required: ['processed', 'closed', 'reopened', 'mergeConflictRefreshed', 'skipped', 'error'],
    },
    401: UNAUTHORIZED_RESPONSE_SCHEMA,
  },
} as const;

export const PROCESS_EXECUTION_MEMORY_BACKLOG_SCHEMA = {
  operationId: 'processExecutionMemoryBacklog',
  summary: 'Process pending execution-memory post-run work',
  description:
    'Called by Cloud Scheduler. Claims pending execution-memory post-run tasks and evaluates/distills reusable lessons.',
  tags: ['internal'],
  body: {
    type: 'object',
    nullable: true,
    additionalProperties: false,
    properties: {
      limit: { type: 'number', minimum: 1, maximum: 50 },
    },
  },
  response: {
    200: {
      description: 'Backlog processing completed',
      type: 'object',
      additionalProperties: false,
      properties: {
        success: { type: 'boolean', enum: [true] },
        data: {
          type: 'object',
          additionalProperties: false,
          properties: {
            claimed: { type: 'number' },
            completed: { type: 'number' },
            skipped: { type: 'number' },
            errored: { type: 'number' },
            taskIds: { type: 'array', items: { type: 'string' } },
          },
          required: ['claimed', 'completed', 'skipped', 'errored', 'taskIds'],
        },
        diagnostics: {
          type: 'object',
          additionalProperties: false,
          properties: {
            requestId: { type: 'string' },
            durationMs: { type: 'number' },
            downstreamStatus: { type: 'number' },
            downstreamRequestId: { type: 'string' },
            endpointCalled: { type: 'string' },
          },
          required: ['requestId'],
        },
      },
      required: ['success', 'data'],
    },
    401: UNAUTHORIZED_RESPONSE_SCHEMA,
    500: INTERNAL_ERROR_RESPONSE_SCHEMA,
  },
} as const;

export const SWEEP_ERRORED_EXECUTION_MEMORY_SCHEMA = {
  operationId: 'sweepErroredExecutionMemory',
  summary: 'Sweep permanently errored execution memory post-run tasks and requeue for retry',
  description:
    'Called by Cloud Scheduler every 6 hours. Finds tasks stuck in error state for 24+ hours and requeues them.',
  tags: ['internal'],
  response: {
    200: {
      description: 'Sweep completed',
      type: 'object',
      additionalProperties: false,
      properties: {
        success: { type: 'boolean', enum: [true] },
        data: {
          type: 'object',
          additionalProperties: false,
          properties: {
            requeued: { type: 'number' },
            skipped: { type: 'number' },
          },
          required: ['requeued', 'skipped'],
        },
      },
      required: ['success', 'data'],
    },
    401: UNAUTHORIZED_RESPONSE_SCHEMA,
    500: INTERNAL_ERROR_RESPONSE_SCHEMA,
  },
} as const;

export const PRUNE_STALE_EXECUTION_MEMORY_SCHEMA = {
  operationId: 'pruneStaleExecutionMemories',
  summary: 'Archive aged zero-application execution memories to reduce corpus noise',
  description:
    'Called by Cloud Scheduler weekly. Archives memories with zero applications older than the configured age threshold.',
  tags: ['internal'],
  body: {
    type: 'object',
    nullable: true,
    additionalProperties: false,
    properties: {
      maxAgeDays: { type: 'number', minimum: 1 },
      dryRun: { type: 'boolean' },
    },
  },
  response: {
    200: {
      description: 'Prune completed',
      type: 'object',
      additionalProperties: false,
      properties: {
        success: { type: 'boolean', enum: [true] },
        data: {
          type: 'object',
          additionalProperties: false,
          properties: {
            archived: { type: 'number' },
            skipped: { type: 'number' },
          },
          required: ['archived', 'skipped'],
        },
      },
      required: ['success', 'data'],
    },
    401: UNAUTHORIZED_RESPONSE_SCHEMA,
    500: INTERNAL_ERROR_RESPONSE_SCHEMA,
  },
} as const;

export const ARCHIVE_STALE_GROUPS_SCHEMA = {
  operationId: 'archiveStaleGroups',
  summary: 'Archive issue groups with no activity for 7+ days',
  description: 'Called by Cloud Scheduler hourly. Archives entire issue groups whose latest lifecycle status activity is older than the staleness threshold.',
  tags: ['internal'],
  body: {
    type: 'object',
    nullable: true,
    properties: {
      staleDays: { type: 'number', description: 'Days of inactivity before archiving (default: 7)' },
    },
  },
  response: {
    200: {
      description: 'Archive completed',
      type: 'object',
      additionalProperties: false,
      properties: {
        totalTasksFetched: { type: 'number' },
        totalGroupsEvaluated: { type: 'number' },
        groupsArchived: { type: 'number' },
        groupsRetained: { type: 'number' },
        groupsSkippedActive: { type: 'number' },
        tasksArchived: { type: 'number' },
        tasksFailed: { type: 'number' },
        durationMs: { type: 'number' },
      },
      required: ['totalTasksFetched', 'totalGroupsEvaluated', 'groupsArchived', 'groupsRetained', 'groupsSkippedActive', 'tasksArchived', 'tasksFailed', 'durationMs'],
    },
    401: UNAUTHORIZED_RESPONSE_SCHEMA,
  },
} as const;

export const AUTO_ARCHIVE_MERGED_TASKS_SCHEMA = {
  operationId: 'autoArchiveMergedTasks',
  summary: 'Archive tasks whose PRs were merged 7+ days ago',
  description: 'Called by Cloud Scheduler daily. Archives code tasks where the associated PR was merged more than the threshold days ago.',
  tags: ['internal'],
  body: {
    type: 'object',
    nullable: true,
    properties: {
      mergeDays: { type: 'number', description: 'Days after PR merge before archiving (default: 7)' },
    },
  },
  response: {
    200: {
      description: 'Archive completed',
      type: 'object',
      additionalProperties: false,
      properties: {
        totalTasksFetched: { type: 'number' },
        totalGroupsEvaluated: { type: 'number' },
        groupsArchived: { type: 'number' },
        groupsSkippedActive: { type: 'number' },
        tasksArchived: { type: 'number' },
        tasksFailed: { type: 'number' },
        durationMs: { type: 'number' },
      },
      required: ['totalTasksFetched', 'totalGroupsEvaluated', 'groupsArchived', 'groupsSkippedActive', 'tasksArchived', 'tasksFailed', 'durationMs'],
    },
    401: UNAUTHORIZED_RESPONSE_SCHEMA,
  },
} as const;

// ---------------------------------------------------------------------------
// Task admin endpoints
// ---------------------------------------------------------------------------

export const GET_TASK_DISPATCH_METADATA_SCHEMA = {
  operationId: 'getTaskDispatchMetadata',
  summary: 'Get dispatch metadata for a task by ID',
  description:
    'Returns the dispatch metadata fields for a code task. ' +
    'Used by the orchestrator as a fallback when a task has been pruned from state.',
  tags: ['internal'],
  params: {
    type: 'object',
    required: ['taskId'],
    properties: {
      taskId: { type: 'string', description: 'Code task ID' },
    },
  },
  response: {
    200: {
      description: 'Task dispatch metadata',
      type: 'object',
      additionalProperties: false,
      properties: {
        taskId: { type: 'string' },
        prompt: { type: 'string' },
        repository: { type: 'string' },
        baseBranch: { type: 'string' },
        agentType: { type: ['string', 'null'] },
        workerType: { type: 'string' },
        linearIssueId: { type: ['string', 'null'] },
        webhookSecret: { type: ['string', 'null'] },
        prNumber: { type: ['number', 'null'] },
        webhookUrl: { type: 'string' },
        continuationPrBranch: { type: ['string', 'null'] },
        trackingCommentId: { type: ['string', 'null'] },
      },
      required: [
        'taskId',
        'prompt',
        'repository',
        'baseBranch',
        'agentType',
        'workerType',
        'linearIssueId',
        'webhookSecret',
        'prNumber',
        'webhookUrl',
        'continuationPrBranch',
        'trackingCommentId',
      ],
    },
    401: UNAUTHORIZED_RESPONSE_SCHEMA,
    404: notFoundResponseSchema('Task not found'),
  },
} as const;

// ---------------------------------------------------------------------------
// Diagnostic endpoints
// ---------------------------------------------------------------------------

export const GET_LINEAR_ISSUE_CONTEXT_SCHEMA = {
  operationId: 'getLinearIssueContext',
  summary: 'Proxy issue context from linear-agent with plan path resolution',
  description:
    'Fetches issue description + comments from linear-agent, resolves plan document path. ' +
    'Used by orchestrator for deep validation instead of direct Linear API access.',
  tags: ['internal'],
  params: {
    type: 'object',
    required: ['identifier'],
    properties: {
      identifier: { type: 'string', description: 'Linear issue identifier (e.g., INT-123)' },
    },
  },
  response: {
    200: {
      description: 'Issue context retrieved',
      type: 'object',
      additionalProperties: false,
      properties: {
        description: { type: ['string', 'null'] },
        comments: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              body: { type: 'string' },
              createdAt: { type: 'string' },
            },
            required: ['body', 'createdAt'],
          },
        },
        planDocumentPath: { type: ['string', 'null'] },
      },
      required: ['description', 'comments', 'planDocumentPath'],
    },
    401: UNAUTHORIZED_RESPONSE_SCHEMA,
    404: notFoundResponseSchema('Issue not found'),
    502: DOWNSTREAM_ERROR_RESPONSE_SCHEMA,
  },
} as const;
