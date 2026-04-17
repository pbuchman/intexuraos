import type { Logger, Result } from '@intexuraos/common-core';
import { ok, err } from '@intexuraos/common-core';
import type { LlmGenerateClient } from '@intexuraos/llm-factory';
import { buildDigestPrompt, type DigestPromptInput } from '@intexuraos/llm-prompts';
import {
  AggregationOutputSchema,
  type AggregationOutput,
} from '../schemas/digestSchemas.js';
import { llmCallFailed, zodValidationFailed, type DigestError } from './digestErrors.js';

export interface AggregateDigestDeps {
  readonly llmClient: LlmGenerateClient;
  readonly logger: Logger;
}

export type AggregateDigestInput = DigestPromptInput;

const PROMPT_TYPE = 'whatsapp-digest-aggregate';

export async function aggregateDigest(
  deps: AggregateDigestDeps,
  input: AggregateDigestInput,
): Promise<Result<AggregationOutput, DigestError>> {
  const prompt = buildDigestPrompt(input);
  const response = await deps.llmClient.generate(prompt, { promptType: PROMPT_TYPE });
  if (!response.ok) {
    return err(llmCallFailed(response.error.message ?? 'LLM call failed'));
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(response.value.content);
  } catch (e) {
    return err(zodValidationFailed(`JSON.parse failed: ${e instanceof Error ? e.message : String(e)}`));
  }

  const validation = AggregationOutputSchema.safeParse(parsed);
  if (!validation.success) {
    return err(zodValidationFailed(validation.error.message));
  }

  return ok(validation.data);
}
