/**
 * Attribution repair helper.
 * Attempts to repair invalid attributions using a single LLM call.
 */

import { type Result, ok, err, type Logger } from '@intexuraos/common-core';
import type { SourceMapItem } from '@intexuraos/llm-prompts';
import type { LlmSynthesisProvider, LlmUsage } from '../ports/llmProvider.js';

export interface RepairAttributionDeps {
  synthesizer: LlmSynthesisProvider;
  logger?: Logger;
}

export interface RepairAttributionResult {
  content: string;
  usage: LlmUsage;
}

function buildRepairPrompt(rawContent: string, sourceMap: readonly SourceMapItem[]): string {
  const allowedIds = sourceMap.map((s) => s.id).join(', ');

  return `The following synthesis output is missing or has malformed Attribution lines.

ALLOWED SOURCE IDs: ${allowedIds}

REQUIRED FORMAT (exactly, at end of each ## section):
Attribution: Primary=S1,S2; Secondary=U1; Constraints=; UNK=false

RULES:
1. Add or fix Attribution lines ONLY at the end of each ## section
2. DO NOT change any other content (text, links, formatting)
3. If uncertain about attribution for a section, set UNK=true
4. Use ONLY the allowed source IDs listed above

SYNTHESIS TO REPAIR:
${rawContent}

OUTPUT the repaired synthesis with correct Attribution lines:`;
}

export async function repairAttribution(
  rawContent: string,
  sourceMap: readonly SourceMapItem[],
  deps: RepairAttributionDeps
): Promise<Result<RepairAttributionResult>> {
  const { synthesizer, logger } = deps;

  if (sourceMap.length === 0) {
    logger?.error({}, 'Cannot repair attribution: empty source map');
    return err(new Error('Cannot repair attribution: empty source map'));
  }

  logger?.info({}, 'Attempting attribution repair');

  const repairPrompt = buildRepairPrompt(rawContent, sourceMap);

  const result = await synthesizer.synthesize(repairPrompt, [], undefined, undefined);

  if (!result.ok) {
    const error = result.error;
    logger?.error({ code: error.code }, `Attribution repair failed: ${error.message}`);
    return err(new Error(`Attribution repair failed: ${error.message}`));
  }

  logger?.info({}, 'Attribution repair completed');
  return ok({
    content: result.value.content,
    usage: result.value.usage ?? { inputTokens: 0, outputTokens: 0, costUsd: 0 },
  });
}
