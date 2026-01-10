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
  const qualityValue = obj['quality'] ?? obj['quality_scale'];

  return (
    (qualityValue === 0 || qualityValue === 1 || qualityValue === 2) &&
    typeof obj['reason'] === 'string' &&
    obj['reason'].length > 0
  );
}
