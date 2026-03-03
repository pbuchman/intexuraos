import { z } from 'zod';

// Worker type validation
export const WorkerTypeSchema = z.enum([
  'opus',
  'auto',
  'sonnet',
  'minimax',
  'glm',
  'qwen3.5-plus',
]);

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
  agentType: z.enum(['planning', 'execution', 'pull_request']).optional(),
  planningPrBranch: z.string().optional(),
  planningPrUrl: z.string().url().optional(),
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
  type: 'not_found' | 'invalid_status' | 'service_error';
  message: string;
}
