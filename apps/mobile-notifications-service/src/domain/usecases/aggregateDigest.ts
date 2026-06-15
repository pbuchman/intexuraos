import type { Logger, Result } from '@intexuraos/common-core';
import { ok, err, getErrorMessage } from '@intexuraos/common-core';
import type { LlmGenerateClient } from '@intexuraos/llm-factory';
import {
  digestPrompt,
  digestRepairPrompt,
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

export const PROMPT_TYPE_AGGREGATE = 'whatsapp-digest-aggregate';
export const PROMPT_TYPE_REPAIR = 'whatsapp-digest-repair';
export const MAX_REPAIR_ATTEMPTS = 3;

export interface AggregateDigestDeps {
  readonly llmClient: LlmGenerateClient;
  readonly logger: Logger;
}

export type AggregateDigestInput = DigestPromptInput;

export async function aggregateDigest(
  deps: AggregateDigestDeps,
  input: AggregateDigestInput,
): Promise<Result<AggregationOutput, DigestError>> {
  const initialPrompt = digestPrompt.build(input);

  const initial = await callAndParse(deps, initialPrompt, PROMPT_TYPE_AGGREGATE);
  if (initial.kind === 'ok') return ok(initial.value);
  if (initial.kind === 'llm-error') return err(llmCallFailed(initial.message));

  let lastResponseContent = initial.responseContent;
  let lastErrorMessage = initial.errorMessage;

  for (let attempt = 1; attempt <= MAX_REPAIR_ATTEMPTS; attempt += 1) {
    deps.logger.warn(
      { attempt, errorMessage: lastErrorMessage, _skipSentry: true },
      'aggregateDigest: invalid response, will repair',
    );
    const repairPrompt = digestRepairPrompt.build({
      originalPrompt: initialPrompt,
      invalidResponse: lastResponseContent,
      errorMessage: lastErrorMessage,
      outputLanguage: input.outputLanguage,
    });
    const repaired = await callAndParse(deps, repairPrompt, PROMPT_TYPE_REPAIR);
    if (repaired.kind === 'ok') return ok(repaired.value);
    if (repaired.kind === 'llm-error') return err(llmCallFailed(repaired.message));
    lastResponseContent = repaired.responseContent;
    lastErrorMessage = repaired.errorMessage;
  }

  return err(repairExhausted(MAX_REPAIR_ATTEMPTS, lastResponseContent));
}

type CallResult =
  | { readonly kind: 'ok'; readonly value: AggregationOutput }
  | { readonly kind: 'llm-error'; readonly message: string }
  | { readonly kind: 'invalid'; readonly responseContent: string; readonly errorMessage: string };

async function callAndParse(
  deps: AggregateDigestDeps,
  prompt: string,
  promptType: string,
): Promise<CallResult> {
  const response = await deps.llmClient.generate(prompt, { promptType });
  if (!response.ok) {
    return { kind: 'llm-error', message: response.error.message };
  }
  const content = response.value.content;
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    return { kind: 'invalid', responseContent: content, errorMessage: `JSON.parse failed: ${getErrorMessage(e)}` };
  }
  const validation = AggregationOutputSchema.safeParse(parsed);
  if (!validation.success) {
    return { kind: 'invalid', responseContent: content, errorMessage: validation.error.message };
  }
  return { kind: 'ok', value: validation.data };
}
