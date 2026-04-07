import type { GeminiClient } from '@intexuraos/infra-gemini';
import type { Logger } from '@intexuraos/common-core';
import type { IntentInterpreter } from '../../domain/ports/intentInterpreter.js';
import type { InterpretedIntent, IntentKind } from '../../domain/models/hellscriptEvent.js';
import type { MaterializedBufferState } from '../../domain/models/materializedBufferState.js';
import { interpretImposePrompt } from '../../prompts/interpret-impose-prompt.js';

const VALID_KINDS = new Set<string>([
  'append_thought',
  'delete_thought',
  'reorder_thoughts',
  'update_draft',
  'fallback_append',
]);

export class GeminiIntentInterpreter implements IntentInterpreter {
  private readonly client: GeminiClient;

  constructor(client: GeminiClient) {
    this.client = client;
  }

  async interpret(
    utterance: string,
    currentState: MaterializedBufferState,
    logger: Logger
  ): Promise<InterpretedIntent> {
    const prompt = interpretImposePrompt.build({ utterance, currentState });

    const result = await this.client.generate(prompt);

    if (!result.ok) {
      logger.warn({ error: result.error }, 'LLM interpretation failed, using fallback');
      return {
        kind: 'fallback_append',
        payload: { text: utterance },
        fallbackReason: 'LLM call failed',
      };
    }

    try {
      const content = result.value.content;
      let jsonStr: string;
      try {
        JSON.parse(content);
        jsonStr = content;
      } catch {
        const jsonMatch = /\{[\s\S]*\}/.exec(content);
        jsonStr = jsonMatch?.[0] ?? content;
      }
      const parsed = JSON.parse(jsonStr) as {
        kind?: string;
        payload?: Record<string, unknown>;
        fallbackReason?: string;
      };

      if (
        parsed.kind === undefined ||
        !VALID_KINDS.has(parsed.kind) ||
        parsed.payload === undefined
      ) {
        logger.warn({ parsed }, 'Invalid LLM response shape, using fallback');
        return {
          kind: 'fallback_append',
          payload: { text: utterance },
          fallbackReason: 'Invalid response shape from LLM',
        };
      }

      return {
        kind: parsed.kind as IntentKind,
        payload: parsed.payload,
        ...(parsed.fallbackReason !== undefined
          ? { fallbackReason: parsed.fallbackReason }
          : {}),
      };
    } catch {
      logger.warn({}, 'Failed to parse LLM response as JSON, using fallback');
      return {
        kind: 'fallback_append',
        payload: { text: utterance },
        fallbackReason: 'Failed to parse LLM response',
      };
    }
  }
}
