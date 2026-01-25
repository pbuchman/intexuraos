/**
 * Zod schemas for todo item extraction.
 * Types are derived from schemas using z.infer<> for single source of truth.
 */

import { z } from 'zod';

/**
 * Schema for individual todo items extracted from natural language.
 */
export const ExtractedItemSchema = z.object({
  title: z.string(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).nullable(),
  dueDate: z.string().nullable(),
  reasoning: z.string(),
});

/**
 * Schema for the complete todo extraction response.
 */
export const TodoExtractionResponseSchema = z.object({
  items: z.array(ExtractedItemSchema),
  summary: z.string(),
});

// Export derived types
export type ExtractedItem = z.infer<typeof ExtractedItemSchema>;
export type TodoExtractionResponse = z.infer<typeof TodoExtractionResponseSchema>;
