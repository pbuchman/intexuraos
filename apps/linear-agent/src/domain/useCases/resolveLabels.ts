/**
 * Pure function for resolving the desired set of label IDs after applying add/remove mutations.
 */

/**
 * Resolve desired label IDs from current labels + add/remove mutations.
 */
export function resolveDesiredLabelIds(
  currentLabels: { name: string }[],
  addLabels: string[],
  removeLabels: string[],
  availableLabels: { id: string; name: string }[]
): string[] {
  const currentLabelNames = new Set(currentLabels.map((l) => l.name));
  for (const label of addLabels) currentLabelNames.add(label);
  for (const label of removeLabels) currentLabelNames.delete(label);
  return availableLabels
    .filter((label) => currentLabelNames.has(label.name))
    .map((label) => label.id);
}
