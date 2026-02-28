/**
 * Zod schemas for Linear issue extraction.
 * Types are derived from schemas using z.infer<> for single source of truth.
 */

import { z } from 'zod';

/**
 * Linear issue priority values (0=No Priority, 1=Urgent, 2=High, 3=Normal, 4=Low)
 */
export type LinearPriority = 0 | 1 | 2 | 3 | 4;

/**
 * Schema for individual Linear issue data extracted from natural language.
 */
export const LinearIssueDataSchema = z.object({
  title: z.string().max(100),
  priority: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  functionalRequirements: z.string().nullable(),
  technicalDetails: z.string().nullable(),
  valid: z.boolean(),
  error: z.string().nullable(),
  reasoning: z.string(),
});

// Export derived types
export type LinearIssueData = z.infer<typeof LinearIssueDataSchema>;

/**
 * Issue type classification for analytics and routing.
 */
export const LinearIssueTypeSchema = z.enum(['feature', 'bug', 'refactor', 'research']);
export type LinearIssueType = z.infer<typeof LinearIssueTypeSchema>;

/**
 * Schema for LLM-generated issue title response.
 * Used by linearIssueTitlePrompt for validation.
 */
export const LinearIssueTitleSchema = z.object({
  title: z.string().min(1).max(80),
  issueType: LinearIssueTypeSchema,
});

export type LinearIssueTitle = z.infer<typeof LinearIssueTitleSchema>;
