/**
 * Linear issue label utilities.
 *
 * Canonical home for label normalization and detection. Previously duplicated in:
 * - apps/code-agent/src/domain/utils/labelUtils.ts
 * - workers/orchestrator/src/services/task-dispatcher.ts (private method)
 * - workers/orchestrator/src/services/system-prompt.ts (inline)
 * - apps/linear-agent/src/domain/useCases/triggerCodeTaskFromAssignment.ts (local function)
 */

export function normalizeLabel(label: string): string {
  return label.trim().toLowerCase().replaceAll('_', '-').replaceAll(' ', '-');
}

export function hasCodeTaskLabel(labels: string[]): boolean {
  return labels.some((label) => normalizeLabel(label) === 'code-task');
}

export function hasPlanningTaskLabel(labels: string[]): boolean {
  return labels.some((label) => normalizeLabel(label) === 'planning-task');
}
