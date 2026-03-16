/**
 * Utilities for mapping and resolving Linear workflow state names to IDs.
 */

/** Maps normalized state key names to their display names in Linear. */
export const STATE_NAME_MAP: Record<string, string> = {
  backlog: 'Backlog',
  todo: 'Todo',
  in_progress: 'In Progress',
  in_review: 'In Review',
  qa: 'QA',
  done: 'Done',
};

/**
 * Find the ID of a workflow state by its display name (case-insensitive).
 * Returns `null` when no matching state is found.
 */
export function findStateId(
  states: { id: string; name: string; type: string }[],
  stateName: string
): string | null {
  const state = states.find(
    (s) => s.name.toLowerCase() === stateName.toLowerCase()
  );
  return state?.id ?? null;
}
