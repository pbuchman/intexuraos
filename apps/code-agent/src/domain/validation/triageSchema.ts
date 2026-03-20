import { z } from 'zod';

const VALID_REVIEW_TYPES = ['code_quality', 'security', 'architecture', 'plan_review'] as const;

export const TriageSkipSchema = z.object({
  action: z.literal('skip'),
  reason: z.string().min(1, 'Skip reason must not be empty'),
});

export const TriageReviewSchema = z.object({
  action: z.literal('request_review'),
  reviewTypes: z.array(z.enum(VALID_REVIEW_TYPES)).min(1, 'At least one review type required'),
});

export const TriageResultSchema = z.discriminatedUnion('action', [
  TriageSkipSchema,
  TriageReviewSchema,
]);

export type TriageResult = z.infer<typeof TriageResultSchema>;
