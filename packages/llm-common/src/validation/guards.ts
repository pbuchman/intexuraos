/**
 * Type guards for validation responses.
 */

export interface InputQualityResult {
  quality: 0 | 1 | 2;
  reason: string;
}

export function isInputQualityResult(value: unknown): value is InputQualityResult {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;

  return (
    (obj['quality'] === 0 || obj['quality'] === 1 || obj['quality'] === 2) &&
    typeof obj['reason'] === 'string' &&
    obj['reason'].length > 0
  );
}
