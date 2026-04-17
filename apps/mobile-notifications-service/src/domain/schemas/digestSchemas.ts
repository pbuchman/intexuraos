/**
 * Zod schemas for the WhatsApp digest pipeline outputs.
 * Types are derived from schemas using z.infer<> for single source of truth.
 */

import { z } from 'zod';

/**
 * Schema for DailySummary — user-facing summary for a single day.
 */
export const DailySummarySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  groupKey: z.string(),
  messageCount: z.number().int().nonnegative(),
  headline: z.string().min(1).max(200),
  bullets: z.array(z.string().min(1).max(300)).min(3).max(7),
  threads: z.array(
    z.object({
      topic: z.string(),
      participants: z.array(z.string()),
      resolved: z.boolean(),
      keyFacts: z.array(z.string()),
    }),
  ),
  moderatorPosts: z.array(
    z.object({
      time: z.string(),
      topic: z.string(),
      summary: z.string(),
    }),
  ),
  openQuestions: z.array(z.string()),
  activityOutliers: z.array(
    z.object({
      sender: z.string(),
      messageCount: z.number().int().positive(),
      note: z.string(),
    }),
  ),
});

/**
 * Schema for GroupState — persistent state for one group, rewritten each run.
 */
export const GroupStateSchema = z.object({
  userId: z.string(),
  groupKey: z.string(),
  updatedAt: z.string(),
  identityLedger: z.array(
    z.object({
      sender: z.string(),
      firstSeen: z.string(),
      totalMessages: z.number().int().nonnegative(),
      activeDays: z.number().int().nonnegative(),
      role: z.enum(['member', 'moderator', 'newcomer']).optional(),
      notes: z.string().optional(),
    }),
  ),
  moderatorEvents: z.array(
    z.object({
      date: z.string(),
      topic: z.string(),
      summary: z.string(),
    }),
  ),
  openThreads: z.array(
    z.object({
      topic: z.string(),
      openedOn: z.string(),
      lastSignal: z.string(),
      lastSignalDate: z.string(),
    }),
  ),
  recentSummaryDates: z.array(z.string()).max(30),
});

/**
 * Schema for AggregationOutput — single LLM response carrying both artifacts.
 */
export const AggregationOutputSchema = z.object({
  dailySummary: DailySummarySchema,
  stateUpdate: GroupStateSchema,
});

// Inferred TypeScript types
export type DailySummary = z.infer<typeof DailySummarySchema>;
export type GroupState = z.infer<typeof GroupStateSchema>;
export type AggregationOutput = z.infer<typeof AggregationOutputSchema>;
