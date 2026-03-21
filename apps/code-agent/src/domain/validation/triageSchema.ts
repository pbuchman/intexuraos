import { z } from 'zod';
import { ALL_REVIEW_TYPES } from '../constants/reviewTypes.js';

export const TriageSkipSchema = z.object({
  action: z.literal('skip'),
  reason: z.string().min(1, 'Skip reason must not be empty'),
});

export const TriageReviewSchema = z.object({
  action: z.literal('request_review'),
  reviewTypes: z.array(z.enum(ALL_REVIEW_TYPES)).min(1, 'At least one review type required'),
});

export const TriageResultSchema = z.discriminatedUnion('action', [
  TriageSkipSchema,
  TriageReviewSchema,
]);

export type TriageResult = z.infer<typeof TriageResultSchema>;
