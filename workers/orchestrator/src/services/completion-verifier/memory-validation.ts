import { stripDockerHeaders } from '../log-formatter.js';
import type { ExecutionMemoryPromptContext } from '../../types/execution-memory.js';
import type { CompletionAgentType } from './schemas.js';

/**
 * Returns the list of empty-memory fields (`['memory_ids_used', 'memory_ids_rejected']`)
 * when memories were injected but both memory-id fields are blank on the parsed response.
 * Returns `undefined` when no enforcement is needed (execution agent, no injected memories,
 * or at least one field is populated).
 */
export function detectEmptyMemoryFields(
  agentType: CompletionAgentType,
  executionMemoryContext: ExecutionMemoryPromptContext | undefined,
  parsed: unknown
): string[] | undefined {
  const hasInjectedMemories =
    executionMemoryContext !== undefined && executionMemoryContext.matchedMemories.length > 0;
  if (!hasInjectedMemories) {
    return undefined;
  }
  if (agentType === 'execution') {
    return undefined;
  }
  const parsedRecord = parsed as Record<string, unknown>;
  /* v8 ignore start -- schema: Zod .optional().default('') guarantees value is always a string after parse @preserve */
  const usedVal =
    typeof parsedRecord['memory_ids_used'] === 'string' ? parsedRecord['memory_ids_used'] : '';
  const rejectedVal =
    typeof parsedRecord['memory_ids_rejected'] === 'string'
      ? parsedRecord['memory_ids_rejected']
      : '';
  /* v8 ignore stop @preserve */
  if (usedVal.trim() === '' && rejectedVal.trim() === '') {
    return ['memory_ids_used', 'memory_ids_rejected'];
  }
  return undefined;
}

function normalizeMemoryCsv(value: string): string[] {
  const trimmed = value.trim();
  if (trimmed === '' || trimmed.toLowerCase() === 'none') {
    return [];
  }
  return trimmed
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '');
}

/**
 * Regex builder for the per-memory acknowledgment bullet the worker must emit.
 *
 * The system prompt (see `workers/orchestrator/src/services/system-prompt.ts`
 * `buildExecutionMemorySection`) emits one bullet per injected memory in this
 * exact shape:
 *
 *   - [<index>] <memoryId> — "<title>" — APPLICABLE|NOT APPLICABLE because …
 *
 * We match the leading `- [<digits>] <memoryId>` token (allowing an optional
 * log-driver prefix like `[claude] ` that the orchestrator prepends to every
 * worker stdout line) so:
 *  * mentions of the memoryId elsewhere (e.g. `memory_ids_used: <id>`) don't
 *    satisfy the acknowledgment requirement, and
 *  * the legacy `[<memoryId>]` format fails loudly, surfacing any
 *    prompt/verifier drift immediately.
 *
 * Exported so the regression-guard test can pin the verifier against the
 * runtime pattern (not a hand-typed literal that could drift independently).
 */
export function buildMemoryAcknowledgmentPattern(memoryId: string): RegExp {
  const escaped = memoryId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(String.raw`^\s*(?:\[[^\]]+\]\s+)?-\s*\[\d+\]\s+${escaped}\b`, 'm');
}

export interface MemoryReportingValidationResult {
  /** Hard failures — the verifier must reject this verdict. */
  failures: string[];
  /** Soft warnings — log only, do not fail. */
  softWarnings: string[];
}

export function validateMemoryReporting(
  rawLogs: string,
  executionMemoryContext: ExecutionMemoryPromptContext,
  agentData: {
    memory_ids_used?: string;
    memory_ids_rejected?: string;
    memory_usage_summary?: string;
  }
): MemoryReportingValidationResult {
  const injectedIds = executionMemoryContext.matchedMemories.map((memory) => memory.memoryId);
  if (injectedIds.length === 0) {
    return { failures: [], softWarnings: [] };
  }

  const normalizedLogs = stripDockerHeaders(rawLogs);

  const hasAcknowledgment =
    normalizedLogs.includes('Execution Memories Received') &&
    injectedIds.every((memoryId) =>
      buildMemoryAcknowledgmentPattern(memoryId).test(normalizedLogs)
    );

  /* v8 ignore start -- schema: Zod schema defaults always provide strings; helper stays optional for structural typing across agent variants @preserve */
  const usedIds = normalizeMemoryCsv(agentData.memory_ids_used ?? '');
  const rejectedIds = normalizeMemoryCsv(agentData.memory_ids_rejected ?? '');
  const summary = (agentData.memory_usage_summary ?? '').trim();
  /* v8 ignore stop @preserve */

  const injectedSet = new Set(injectedIds);
  const usedSet = new Set(usedIds);
  const rejectedSet = new Set(rejectedIds);

  const tripletFailures: string[] = [];
  if (summary === '') {
    tripletFailures.push('memory_usage_summary');
  }
  if (usedIds.some((memoryId) => !injectedSet.has(memoryId))) {
    tripletFailures.push('memory_ids_used_invalid');
  }
  if (rejectedIds.some((memoryId) => !injectedSet.has(memoryId))) {
    tripletFailures.push('memory_ids_rejected_invalid');
  }
  if (usedIds.some((memoryId) => rejectedSet.has(memoryId))) {
    tripletFailures.push('memory_ids_overlap');
  }
  const unaccountedIds = injectedIds.filter(
    (memoryId) => !usedSet.has(memoryId) && !rejectedSet.has(memoryId)
  );
  if (unaccountedIds.length > 0) {
    tripletFailures.push('memory_ids_unaccounted');
  }

  const failures: string[] = [...tripletFailures];
  const softWarnings: string[] = [];
  if (!hasAcknowledgment) {
    if (tripletFailures.length === 0) {
      softWarnings.push('memory_acknowledgment');
    } else {
      failures.push('memory_acknowledgment');
    }
  }

  return { failures, softWarnings };
}
