import { z } from 'zod';
import type { MessageDigestAggregate } from './types.js';

export const MESSAGE_DIGEST_HEADLINE_MAX_LENGTH = 200;
export const MESSAGE_DIGEST_SUMMARY_MAX_LENGTH = 12_000;
export const MESSAGE_DIGEST_CONTINUITY_MEMORY_MAX_LENGTH = 8_000;
export const MESSAGE_DIGEST_EVIDENCE_REF_MAX_COUNT = 1_000;

const evidenceMessageRefSchema = z.string().regex(/^[0-9a-f]{64}$/u);

export const MessageDigestAggregateSchema = z
  .object({
    headline: z.string().trim().min(1).max(MESSAGE_DIGEST_HEADLINE_MAX_LENGTH),
    summaryMarkdown: z.string().max(MESSAGE_DIGEST_SUMMARY_MAX_LENGTH),
    evidenceMessageRefs: z
      .array(evidenceMessageRefSchema)
      .max(MESSAGE_DIGEST_EVIDENCE_REF_MAX_COUNT),
    continuityMemoryMarkdown: z.string().max(MESSAGE_DIGEST_CONTINUITY_MEMORY_MAX_LENGTH),
  })
  .strict();

export function createMessageDigestAggregateSchema(
  allowedEvidenceMessageRefs: ReadonlySet<string>
): z.ZodType<MessageDigestAggregate> {
  return MessageDigestAggregateSchema.superRefine((aggregate, context) => {
    const observed = new Set<string>();
    for (const [index, messageRef] of aggregate.evidenceMessageRefs.entries()) {
      if (observed.has(messageRef)) {
        context.addIssue({
          code: 'custom',
          message: 'Duplicate evidence message reference',
          path: ['evidenceMessageRefs', index],
        });
      }
      observed.add(messageRef);
      if (!allowedEvidenceMessageRefs.has(messageRef)) {
        context.addIssue({
          code: 'custom',
          message: 'Unknown evidence message reference',
          path: ['evidenceMessageRefs', index],
        });
      }
    }
  });
}
