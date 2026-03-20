import type { GeminiClient } from '@intexuraos/infra-gemini';
import type { Result, Logger } from '@intexuraos/common-core';
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
  ): Promise<Result<string>> {
    const prompt = generateDraftPrompt.build({ state, priorDraft, requestText });

    const result = await this.client.generate(prompt);

    if (!result.ok) {
      logger.error({ error: result.error }, 'Draft generation failed');
      return { ok: false, error: new Error('Draft generation failed') };
    }

    return { ok: true, value: result.value.content };
  }
}
