import { z } from 'zod';

// Worker type validation
export const WorkerTypeSchema = z.enum(['opus', 'auto', 'glm']);

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
  slug: z.string().optional(),
  webhookUrl: z.string().url(),
  webhookSecret: z.string().min(1),
  actionId: z.string().optional(),
});

// Type inference from schema
export type CreateTaskRequestInput = z.infer<typeof CreateTaskRequestSchema>;
