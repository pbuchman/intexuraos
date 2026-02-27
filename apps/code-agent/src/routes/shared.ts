/**
 * Shared types and utilities for code-agent routes.
 * Extracted from codeRoutes.ts to enable modular route files.
 */

// Re-export JwtValidator from codeRoutes for backwards compatibility during transition
export type JwtValidator = (request: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply) => Promise<void>;

export interface CodeRoutesOptions {
  jwtValidator: JwtValidator;
}

// Response schema for created task (extracted from codeRoutes.ts lines 38-117)
export const codeTaskSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    userId: { type: 'string' },
    prompt: { type: 'string' },
    sanitizedPrompt: { type: 'string' },
    systemPromptHash: { type: 'string' },
    workerType: { type: 'string', enum: ['opus', 'auto', 'sonnet', 'minimax', 'glm'] },
    workerLocation: { type: 'string' },
    repository: { type: 'string' },
    baseBranch: { type: 'string' },
    traceId: { type: 'string' },
    status: {
      type: 'string',
      enum: ['dispatched', 'running', 'designed', 'implemented', 'failed', 'interrupted', 'cancelled'],
    },
    dedupKey: { type: 'string' },
    callbackReceived: { type: 'boolean' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
    actionId: { type: 'string', nullable: true },
    approvalEventId: { type: 'string', nullable: true },
    linearIssueId: { type: 'string', nullable: true },
    linearIssueTitle: { type: 'string', nullable: true },
    linearIssueUrl: { type: 'string', nullable: true },
    linearFallback: { type: 'boolean', nullable: true },
    executionPhase: { type: 'string', enum: ['design', 'execution'] },
    implementationTaskId: { type: 'string' },
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
            retryAfter: { type: 'number', nullable: true },
            manualSteps: { type: 'string', nullable: true },
            supportLink: { type: 'string', nullable: true },
          },
        },
      },
    },
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

/**
 * Convert Firestore Timestamp to ISO string for JSON serialization
 * Exported for testing
 */
export function timestampToIso(
  timestamp: { toDate: () => Date } | string | undefined
): string | undefined {
  if (timestamp === undefined) {
    return undefined;
  }
  if (typeof timestamp === 'string') {
    return timestamp;
  }
  if (typeof timestamp.toDate === 'function') {
    return timestamp.toDate().toISOString();
  }
  return undefined;
}

/**
 * Convert CodeTask domain model to API response format
 */
export function taskToApiResponse(task: {
  id: string;
  userId: string;
  prompt: string;
  sanitizedPrompt: string;
  systemPromptHash: string;
  workerType: 'opus' | 'auto' | 'sonnet' | 'minimax' | 'glm';
  workerLocation: string;
  repository: string;
  baseBranch: string;
  traceId: string;
  status: 'dispatched' | 'running' | 'designed' | 'implemented' | 'failed' | 'interrupted' | 'cancelled';
  dedupKey: string;
  callbackReceived: boolean;
  createdAt: unknown;
  updatedAt: unknown;
  actionId?: string;
  approvalEventId?: string;
  linearIssueId?: string;
  linearIssueTitle?: string;
  linearIssueUrl?: string;
  linearFallback?: boolean;
  executionPhase?: 'design' | 'execution';
  implementationTaskId?: string;
  parentTaskId?: string;
  followUpReason?: string;
  result?: {
    prUrl?: string;
    branch?: string;
    commits?: number;
    summary?: string;
    ciFailed?: boolean;
    partialWork?: boolean;
    rebaseResult?: 'success' | 'conflict' | 'skipped';
  };
  error?: {
    code: string;
    message: string;
    remediation?: {
      retryAfter?: number;
      manualSteps?: string;
      supportLink?: string;
    };
  };
  completedAt?: unknown;
  dispatchedAt?: unknown;
  logChunksDropped?: number;
  statusSummary?: unknown;
  retriedFrom?: string;
}): {
  id: string;
  userId: string;
  prompt: string;
  sanitizedPrompt: string;
  systemPromptHash: string;
  workerType: 'opus' | 'auto' | 'sonnet' | 'minimax' | 'glm';
  workerLocation: string;
  repository: string;
  baseBranch: string;
  traceId: string;
  status: 'dispatched' | 'running' | 'designed' | 'implemented' | 'failed' | 'interrupted' | 'cancelled';
  dedupKey: string;
  callbackReceived: boolean;
  createdAt: string;
  updatedAt: string;
  actionId?: string;
  approvalEventId?: string;
  linearIssueId?: string;
  linearIssueTitle?: string;
  linearIssueUrl?: string;
  linearFallback?: boolean;
  executionPhase?: 'design' | 'execution';
  implementationTaskId?: string;
  parentTaskId?: string;
  followUpReason?: string;
  result?: {
    prUrl?: string;
    branch?: string;
    commits?: number;
    summary?: string;
    ciFailed?: boolean;
    partialWork?: boolean;
    rebaseResult?: 'success' | 'conflict' | 'skipped';
  };
  error?: {
    code: string;
    message: string;
    remediation?: {
      retryAfter?: number;
      manualSteps?: string;
      supportLink?: string;
    };
  };
} {
  return {
    id: task.id,
    userId: task.userId,
    prompt: task.prompt,
    sanitizedPrompt: task.sanitizedPrompt,
    systemPromptHash: task.systemPromptHash,
    workerType: task.workerType,
    workerLocation: task.workerLocation,
    repository: task.repository,
    baseBranch: task.baseBranch,
    traceId: task.traceId,
    status: task.status,
    dedupKey: task.dedupKey,
    callbackReceived: task.callbackReceived,
    createdAt: timestampToIso(task.createdAt as { toDate: () => Date } | string | undefined) ?? '',
    updatedAt: timestampToIso(task.updatedAt as { toDate: () => Date } | string | undefined) ?? '',
    ...(task.actionId !== undefined && { actionId: task.actionId }),
    ...(task.approvalEventId !== undefined && { approvalEventId: task.approvalEventId }),
    ...(task.linearIssueId !== undefined && { linearIssueId: task.linearIssueId }),
    ...(task.linearIssueTitle !== undefined && { linearIssueTitle: task.linearIssueTitle }),
    ...(task.linearIssueUrl !== undefined && { linearIssueUrl: task.linearIssueUrl }),
    ...(task.linearFallback !== undefined && { linearFallback: task.linearFallback }),
    ...(task.executionPhase !== undefined && { executionPhase: task.executionPhase }),
    ...(task.implementationTaskId !== undefined && { implementationTaskId: task.implementationTaskId }),
    ...(task.parentTaskId !== undefined && { parentTaskId: task.parentTaskId }),
    ...(task.followUpReason !== undefined && { followUpReason: task.followUpReason }),
    ...(task.result !== undefined && { result: task.result }),
    ...(task.error !== undefined && { error: task.error }),
  };
}
