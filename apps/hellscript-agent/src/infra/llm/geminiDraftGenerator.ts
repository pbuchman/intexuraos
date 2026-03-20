import type { GeminiClient } from '@intexuraos/infra-gemini';
import type { Logger } from '@intexuraos/common-core';
import type { DraftGenerator } from '../../domain/ports/draftGenerator.js';
import type { MaterializedBufferState } from '../../domain/models/materializedBufferState.js';
import { generateDraftPrompt } from '../../prompts/generate-draft-prompt.js';

export class GeminiDraftGenerator implements DraftGenerator {
  private readonly client: GeminiClient;

  constructor(client: GeminiClient) {
    this.client = client;
  }

  async generate(
    state: MaterializedBufferState,
    priorDraft: string | null,
    requestText: string,
    logger: Logger
  ): Promise<string> {
    const prompt = generateDraftPrompt.build({ state, priorDraft, requestText });

    const result = await this.client.generate(prompt);

    if (!result.ok) {
      logger.error({ error: result.error }, 'Draft generation failed');
      return priorDraft ?? '# Draft\n\n(Generation failed. Please try again.)';
    }

    return result.value.content;
  }
}
