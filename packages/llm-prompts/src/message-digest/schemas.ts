import { z } from 'zod';
import type { MessageDigestAggregate } from './types.js';

export const MESSAGE_DIGEST_HEADLINE_MAX_LENGTH = 200;
export const MESSAGE_DIGEST_SUMMARY_MAX_LENGTH = 12_000;
export const MESSAGE_DIGEST_CONTINUITY_MEMORY_MAX_LENGTH = 8_000;
export const MESSAGE_DIGEST_EVIDENCE_REF_MAX_COUNT = 1_000;
export const MESSAGE_DIGEST_WHATSAPP_PREVIEW_MAX_SECTIONS = 3;
export const MESSAGE_DIGEST_WHATSAPP_PREVIEW_SECTION_TITLE_MAX_LENGTH = 48;
export const MESSAGE_DIGEST_WHATSAPP_PREVIEW_MAX_ITEMS_PER_SECTION = 2;
export const MESSAGE_DIGEST_WHATSAPP_PREVIEW_ITEM_MAX_LENGTH = 240;

const evidenceMessageRefSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const opaqueMessageReferencePattern = /(?<![0-9a-f])[0-9a-f]{64}(?![0-9a-f])/iu;

const whatsappPreviewSchema = z
  .object({
    sections: z
      .array(
        z
          .object({
            icon: z.enum([
              'attention',
              'people',
              'location',
              'decision',
              'question',
              'sentiment',
              'update',
            ]),
            title: z
              .string()
              .trim()
              .min(1)
              .max(MESSAGE_DIGEST_WHATSAPP_PREVIEW_SECTION_TITLE_MAX_LENGTH),
            items: z
              .array(z.string().trim().min(1).max(MESSAGE_DIGEST_WHATSAPP_PREVIEW_ITEM_MAX_LENGTH))
              .min(1)
              .max(MESSAGE_DIGEST_WHATSAPP_PREVIEW_MAX_ITEMS_PER_SECTION),
          })
          .strict()
      )
      .min(1)
      .max(MESSAGE_DIGEST_WHATSAPP_PREVIEW_MAX_SECTIONS),
  })
  .strict();

export const MessageDigestAggregateSchema = z
  .object({
    headline: z.string().trim().min(1).max(MESSAGE_DIGEST_HEADLINE_MAX_LENGTH),
    summaryMarkdown: z.string().max(MESSAGE_DIGEST_SUMMARY_MAX_LENGTH),
    whatsappPreview: whatsappPreviewSchema,
    evidenceMessageRefs: z
      .array(evidenceMessageRefSchema)
      .max(MESSAGE_DIGEST_EVIDENCE_REF_MAX_COUNT),
    continuityMemoryMarkdown: z.string().max(MESSAGE_DIGEST_CONTINUITY_MEMORY_MAX_LENGTH),
  })
  .strict()
  .superRefine((aggregate, context) => {
    for (const field of contentFields(aggregate)) {
      if (!opaqueMessageReferencePattern.test(field.value)) continue;
      context.addIssue({
        code: 'custom',
        message: 'Opaque message reference leaked into content',
        path: field.path,
      });
    }
  });

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

function contentFields(
  aggregate: MessageDigestAggregate
): { path: (string | number)[]; value: string }[] {
  const fields: { path: (string | number)[]; value: string }[] = [
    { path: ['headline'], value: aggregate.headline },
    { path: ['summaryMarkdown'], value: aggregate.summaryMarkdown },
    { path: ['continuityMemoryMarkdown'], value: aggregate.continuityMemoryMarkdown },
  ];
  for (const [sectionIndex, section] of aggregate.whatsappPreview.sections.entries()) {
    fields.push({
      path: ['whatsappPreview', 'sections', sectionIndex, 'title'],
      value: section.title,
    });
    for (const [itemIndex, item] of section.items.entries()) {
      fields.push({
        path: ['whatsappPreview', 'sections', sectionIndex, 'items', itemIndex],
        value: item,
      });
    }
  }
  return fields;
}
