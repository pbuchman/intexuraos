/**
 * Zod schemas for command classification.
 * Types are derived from schemas using z.infer<> for single source of truth.
 */

import { z } from 'zod';

/**
 * Valid command types that can be classified.
 */
export const COMMAND_TYPES = [
  'todo',
  'research',
  'note',
  'link',
  'calendar',
  'reminder',
  'linear',
] as const;

export type CommandType = (typeof COMMAND_TYPES)[number];

/**
 * Schema for command classification response from LLM.
 */
export const CommandClassificationSchema = z.object({
  type: z.enum(COMMAND_TYPES),
  confidence: z.number().min(0).max(1),
  title: z.string().max(50),
  reasoning: z.string(),
});

// Export derived types
export type CommandClassification = z.infer<typeof CommandClassificationSchema>;
