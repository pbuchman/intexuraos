import type { Logger } from 'pino';
import { commandClassifierPrompt, CommandClassificationSchema } from '@intexuraos/llm-prompts';
import { formatZodErrors } from '@intexuraos/llm-utils';
import type { LlmGenerateClient } from '@intexuraos/llm-factory';
import type { CommandType } from '../../domain/models/command.js';
import type {
  Classifier,
  ClassificationResult,
  ClassifyOptions,
} from '../../domain/ports/classifier.js';

const VALID_TYPES: readonly CommandType[] = [
  'todo',
  'research',
  'note',
  'link',
  'calendar',
  'reminder',
  'linear',
  'code',
] as const;

const PWA_SHARED_LINK_CONFIDENCE_BOOST = 0.1;

export function createGeminiClassifier(client: LlmGenerateClient, logger: Logger): Classifier {
  return {
    async classify(text: string, options?: ClassifyOptions): Promise<ClassificationResult> {
      const prompt = commandClassifierPrompt.build({ message: text });

      const result = await client.generate(prompt);

      if (!result.ok) {
        throw new Error(`Classification failed: ${result.error.message}`);
      }

      const parsed = parseClassifyResponse(result.value.content, logger);

      let adjustedConfidence = parsed.confidence;
      let adjustedReasoning = parsed.reasoning;

      if (parsed.type === 'link' && options?.sourceType === 'pwa-shared') {
        adjustedConfidence = Math.min(1, parsed.confidence + PWA_SHARED_LINK_CONFIDENCE_BOOST);
        adjustedReasoning = `${parsed.reasoning} (confidence boosted: PWA share source)`;
      }

      return {
        type: parsed.type,
        confidence: adjustedConfidence,
        title: parsed.title,
        reasoning: adjustedReasoning,
      };
    },
  };
}

function parseClassifyResponse(
  response: string,
  logger: Logger
): { type: CommandType; confidence: number; title: string; reasoning: string } {
  const jsonMatch = /\{[\s\S]*}/.exec(response);
  if (jsonMatch === null) {
    logger.warn(
      { rawResponsePreview: response.slice(0, 500) },
      'Classification response contains no JSON, falling back to note'
    );
    return {
      type: 'note',
      confidence: 0.3,
      title: 'Unknown',
      reasoning: 'Failed to parse response, defaulting to note',
    };
  }

  const cleaned: string = jsonMatch[0];
  const parsed: unknown = JSON.parse(cleaned);

  const validationResult = CommandClassificationSchema.safeParse(parsed);
  if (!validationResult.success) {
    const zodErrors: string = formatZodErrors(validationResult.error);
    logger.warn(
      { zodErrors, rawResponsePreview: cleaned.slice(0, 500) },
      'Classification validation failed, falling back to note'
    );
    return {
      type: 'note',
      confidence: 0.3,
      title: 'Unknown',
      reasoning: `Invalid response format: ${zodErrors}`,
    };
  }

  return {
    type: validationResult.data.type,
    confidence: validationResult.data.confidence,
    title: validationResult.data.title,
    reasoning: validationResult.data.reasoning,
  };
}
