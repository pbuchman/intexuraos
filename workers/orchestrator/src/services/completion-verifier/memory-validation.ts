import { stripDockerHeaders } from '../log-formatter.js';
import type { ExecutionMemoryPromptContext } from '../../types/execution-memory.js';
import type { CompletionAgentType } from './schemas.js';

/**
 * Returns the list of empty-memory fields (`['memory_ids_used', 'memory_ids_rejected']`)
 * when memories were injected but both memory-id fields are blank on the parsed response.
 * Returns `undefined` when no enforcement is needed (no injected memories or at least one
 * memory-id field is populated).
 *
 * Note: this runs for ALL agent types, including execution. Previously the execution agent
 * was short-circuited because its Zod schema enforced the memory fields as required, but
 * EXECUTION_SCHEMA now relaxes them to optional (parity with other agent schemas), so
 * emptiness is the only remaining signal we can use. The returned field names route through
 * the verifier's telemetry bucket — non-blocking for tier=optional workers.
 */
export function detectEmptyMemoryFields(
  _agentType: CompletionAgentType,
  executionMemoryContext: ExecutionMemoryPromptContext | undefined, // @allow-undefined-type -- positional parameter kept explicit for callers that pass the value through
  parsed: unknown
): string[] | undefined {
  const hasInjectedMemories =
    executionMemoryContext !== undefined && executionMemoryContext.matchedMemories.length > 0;
  if (!hasInjectedMemories) {
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

/** Field names that represent memory-acknowledgment telemetry, not deliverable contract.
 *
 * Centralised here because this module is the only producer of these names:
 *  - `detectEmptyMemoryFields` emits `memory_ids_used` / `memory_ids_rejected`.
 *  - `validateMemoryReporting` emits the remaining six members.
 * Callers that need to partition a flat `missingFields` list must use `partitionMissingFields`
 * rather than re-deriving the set — otherwise the two copies can drift. */
const TELEMETRY_FIELD_NAMES: ReadonlySet<string> = new Set([
  'memory_acknowledgment',
  'memory_ids_used',
  'memory_ids_used_invalid',
  'memory_ids_rejected',
  'memory_ids_rejected_invalid',
  'memory_ids_overlap',
  'memory_ids_unaccounted',
  'memory_usage_summary',
]);

/** True when the given field name is memory-telemetry only (not part of the deliverable contract). */
export function isTelemetryField(fieldName: string): boolean {
  return TELEMETRY_FIELD_NAMES.has(fieldName);
}

/** Partitions a flat missing-fields list into blocking (deliverable) and telemetry (memory ack). */
export function partitionMissingFields(fields: readonly string[]): {
  blocking: string[];
  telemetry: string[];
} {
  const blocking: string[] = [];
  const telemetry: string[] = [];
  for (const field of fields) {
    if (isTelemetryField(field)) {
      telemetry.push(field);
    } else {
      blocking.push(field);
    }
  }
  return { blocking, telemetry };
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
