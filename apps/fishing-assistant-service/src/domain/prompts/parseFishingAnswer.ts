import { err, ok, type Result } from '@intexuraos/common-core';
import { z } from 'zod';

export const FishingAnswerSchema = z.object({
  answerMarkdown: z.string(),
  citations: z.array(
    z.object({
      sourceId: z.string(),
      usedFor: z.string(),
    })
  ),
  confidence: z.enum(['high', 'medium', 'low']),
});

export type ParsedFishingAnswer = z.infer<typeof FishingAnswerSchema>;

function stripCodeFences(content: string): string {
  return content
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

export function parseFishingAnswer(
  content: string
): Result<ParsedFishingAnswer, { code: 'INVALID_OUTPUT'; message: string }> {
  try {
    const parsed = JSON.parse(stripCodeFences(content)) as unknown;
    const result = FishingAnswerSchema.safeParse(parsed);
    if (!result.success) {
      return err({
        code: 'INVALID_OUTPUT',
        /* v8 ignore start -- schema: Zod safeParse failure fallback is defensive when issues[0] is unexpectedly absent @preserve */
        message: result.error.issues[0]?.message ?? 'Invalid Fishing Assistant response.',
        /* v8 ignore stop @preserve */
      });
    }
    return ok(result.data);
  } catch {
    return err({
      code: 'INVALID_OUTPUT',
      message: 'Fishing Assistant response was not valid JSON.',
    });
  }
}
