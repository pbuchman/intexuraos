/**
 * Type guards for validation responses.
 */

import { InputQualitySchema } from '../shared/contextSchemas.js';

// Re-export type for backwards compatibility
export type InputQualityResult = import('../shared/contextSchemas.js').InputQuality;

export function isInputQualityResult(value: unknown): value is InputQualityResult {
  return InputQualitySchema.safeParse(value).success;
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
