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
  const qualityKey = 'quality' in obj ? 'quality' : 'quality_scale' in obj ? 'quality_scale' : null;
  const qualityValue = qualityKey ? obj[qualityKey] : undefined;

  // Check if quality is a valid number (0, 1, or 2)
  const isValidQuality = qualityValue === 0 || qualityValue === 1 || qualityValue === 2;

  // Check if reason is a non-empty string
  const hasValidReason = typeof obj['reason'] === 'string' && obj['reason'].length > 0;

  return isValidQuality && hasValidReason;
}

export function getInputQualityGuardError(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) {
    return 'Response is not an object';
  }

  const obj = value as Record<string, unknown>;
  const qualityKey = 'quality' in obj ? 'quality' : 'quality_scale' in obj ? 'quality_scale' : null;
  const qualityValue = qualityKey ? obj[qualityKey] : undefined;

  if (qualityValue === undefined) {
    return 'Missing "quality" field';
  }

  if (typeof qualityValue !== 'number') {
    return `"quality" must be a number (0, 1, or 2), got ${typeof qualityValue}: ${JSON.stringify(qualityValue)}`;
  }

  if (qualityValue !== 0 && qualityValue !== 1 && qualityValue !== 2) {
    return `"quality" must be 0, 1, or 2, got ${String(qualityValue)}`;
  }

  if (typeof obj['reason'] !== 'string' || obj['reason'].length === 0) {
    return 'Missing or invalid "reason" field (must be a non-empty string)';
  }

  return null;
}
