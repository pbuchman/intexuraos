import { CODE_TASK_WORKER_TYPES } from '@intexuraos/common-core';
import { z } from 'zod';

// Worker type validation
export const WorkerTypeSchema = z.enum(CODE_TASK_WORKER_TYPES);

// Task status validation
export const TaskStatusSchema = z.enum([
  'queued',
  'running',
  'completed',
  'failed',
  'interrupted',
  'cancelled',
]);

// Remediation action validation
export const RemediationActionSchema = z.enum([
  'retry',
  'wait',
  'fix_code',
  'contact_support',
  'retry_smaller',
]);

const ExecutionMemoryPromptMemorySchema = z.object({
  memoryId: z.string().min(1),
  title: z.string().min(1),
  memoryType: z.enum(['implementation_pattern', 'verification_pattern', 'pitfall_pattern']),
  score: z.number(),
  appliesWhen: z.string().min(1),
  action: z.string().min(1),
  avoid: z.string().min(1),
  verification: z.string().min(1),
});

const ExecutionMemoryPromptContextSchema = z.object({
  applicationId: z.string().min(1),
  retrievalVersion: z.string().min(1),
  querySummary: z.string().min(1),
  matchedMemories: z.array(ExecutionMemoryPromptMemorySchema),
});

// POST /tasks request schema
export const CreateTaskRequestSchema = z.object({
  taskId: z.string().min(1),
  workerType: WorkerTypeSchema,
  prompt: z.string().min(1),
  repository: z.string().optional(),
  baseBranch: z.string().optional(),
  linearIssueId: z.string().optional(),
  linearIssueTitle: z.string().optional(),
  linearIssueLabels: z.array(z.string()).default([]),
  hasChildren: z.boolean().default(false),
  slug: z.string().optional(),
  webhookUrl: z.string().url(),
  webhookSecret: z.string().min(1),
  actionId: z.string().optional(),
  agentType: z.enum(['planning', 'execution', 'pull_request', 'review', 'remediation']).optional(),
  executionMemoryContext: ExecutionMemoryPromptContextSchema.optional(),
  trackingCommentId: z.string().min(1).optional(),
  prNumber: z.number().int().positive().optional(),
  continuationPrNumber: z.number().int().positive().optional(),
  continuationPrBranch: z.string().min(1).optional(),
  reviewTypes: z
    .array(z.enum(['code_quality', 'security', 'architecture', 'plan_review', 'test_quality']))
    .optional(),
});

// POST /tasks/:id/message request schema
export const SendMessageRequestSchema = z.object({
  message: z.string().min(1).max(20000),
});

// Type inference from schema
export type CreateTaskRequestInput = z.infer<typeof CreateTaskRequestSchema>;

// Send message result types
export interface SendMessageResult {
  action: 'queued' | 'resumed';
  pendingMessages?: string[];
}

export interface SendMessageError {
  type: 'not_found' | 'invalid_status' | 'service_error' | 'invalid_agent_type';
  message: string;
}
