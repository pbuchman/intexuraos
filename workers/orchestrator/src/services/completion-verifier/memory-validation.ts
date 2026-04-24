import type { ExecutionMemoryPromptContext } from '../../types/execution-memory.js';
import type { CompletionAgentType } from './schemas.js';

/**
 * Returns ['memory_ids_used', 'memory_ids_rejected'] when memories were
 * injected but the agent reported neither using nor rejecting any.
 * Returns undefined when no enforcement is needed (no injected memories or
 * at least one memory-id field is populated).
 *
 * Reads from coerced data (arrays), not raw record (strings).
 */
export function detectEmptyMemoryFields(
  _agentType: CompletionAgentType,
  executionMemoryContext: ExecutionMemoryPromptContext | undefined, // @allow-undefined-type -- positional optional
  data: Record<string, unknown>
): string[] | undefined {
  const hasInjectedMemories =
    executionMemoryContext !== undefined && executionMemoryContext.matchedMemories.length > 0;
  if (!hasInjectedMemories) return undefined;

  const used = Array.isArray(data['memory_ids_used']) ? (data['memory_ids_used'] as string[]) : [];
  const rejected = Array.isArray(data['memory_ids_rejected'])
    ? (data['memory_ids_rejected'] as string[])
    : [];
  if (used.length === 0 && rejected.length === 0) {
    return ['memory_ids_used', 'memory_ids_rejected'];
  }
  return undefined;
}

/** Field names that represent memory-acknowledgment telemetry, not deliverable
 * contract. Used by `partitionMissingFields` so the dispatcher can route
 * telemetry-only misses to tier-aware acceptance instead of a hard fail. */
export const TELEMETRY_FIELD_NAMES: ReadonlySet<string> = new Set([
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
