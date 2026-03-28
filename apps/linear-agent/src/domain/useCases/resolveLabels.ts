/**
 * Pure function for resolving the desired set of label IDs after applying add/remove mutations.
 */

/**
 * Resolve desired label IDs from current labels + add/remove mutations.
 *
 * Returns both the resolved label IDs and any addLabels that were not found
 * in the available set (droppedLabels). Callers should log a warning when
 * droppedLabels is non-empty — a dropped label means the requested label
 * name does not exist as a team label in Linear.
 */
export function resolveDesiredLabelIds(
  currentLabels: { name: string }[],
  addLabels: string[],
  removeLabels: string[],
  availableLabels: { id: string; name: string }[]
): { labelIds: string[]; droppedLabels: string[] } {
  const availableLabelNames = new Set(availableLabels.map((l) => l.name));
  const droppedLabels = addLabels.filter((name) => !availableLabelNames.has(name));

  const currentLabelNames = new Set(currentLabels.map((l) => l.name));
  for (const label of addLabels) currentLabelNames.add(label);
  for (const label of removeLabels) currentLabelNames.delete(label);
  const labelIds = availableLabels
    .filter((label) => currentLabelNames.has(label.name))
    .map((label) => label.id);

  return { labelIds, droppedLabels };
}
