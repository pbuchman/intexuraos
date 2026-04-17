import type { Logger, Result } from '@intexuraos/common-core';
import { ok, err, getErrorMessage } from '@intexuraos/common-core';
import type { LlmGenerateClient } from '@intexuraos/llm-factory';
import {
  buildDigestPrompt,
  buildDigestRepairPrompt,
  type DigestPromptInput,
} from '@intexuraos/llm-prompts';
import {
  AggregationOutputSchema,
  type AggregationOutput,
} from '../schemas/digestSchemas.js';
import {
  llmCallFailed,
  repairExhausted,
  type DigestError,
} from './digestErrors.js';

export interface AggregateDigestDeps {
  readonly llmClient: LlmGenerateClient;
  readonly logger: Logger;
}

export type AggregateDigestInput = DigestPromptInput;

const PROMPT_TYPE_AGGREGATE = 'whatsapp-digest-aggregate';
const PROMPT_TYPE_REPAIR = 'whatsapp-digest-repair';
const MAX_REPAIR_ATTEMPTS = 3;

export async function aggregateDigest(
  deps: AggregateDigestDeps,
  input: AggregateDigestInput,
): Promise<Result<AggregationOutput, DigestError>> {
  const initialPrompt = buildDigestPrompt(input);
  let prompt = initialPrompt;
  let promptType = PROMPT_TYPE_AGGREGATE;
  let lastResponseContent = '';
  let lastErrorMessage = '';

  for (let attempt = 0; attempt <= MAX_REPAIR_ATTEMPTS; attempt += 1) {
    const response = await deps.llmClient.generate(prompt, { promptType });
    if (!response.ok) {
      return err(llmCallFailed(response.error.message));
    }
    lastResponseContent = response.value.content;

    const parsed = tryParseAndValidate(lastResponseContent);
    if (parsed.ok) return ok(parsed.value);
    lastErrorMessage = parsed.error;

    deps.logger.warn(
      { attempt, errorMessage: lastErrorMessage },
      'aggregateDigest: invalid response, will repair',
    );

    prompt = buildDigestRepairPrompt(initialPrompt, lastResponseContent, lastErrorMessage);
    promptType = PROMPT_TYPE_REPAIR;
  }

  return err(repairExhausted(MAX_REPAIR_ATTEMPTS, lastResponseContent));
}

function tryParseAndValidate(content: string): { ok: true; value: AggregationOutput } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    return { ok: false, error: `JSON.parse failed: ${getErrorMessage(e)}` };
  }
  const validation = AggregationOutputSchema.safeParse(parsed);
  if (!validation.success) {
    return { ok: false, error: validation.error.message };
  }
  return { ok: true, value: validation.data };
}
