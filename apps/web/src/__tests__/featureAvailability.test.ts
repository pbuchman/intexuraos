import { describe, expect, it } from 'vitest';
import { resolveFeatureAvailability } from '../featureAvailability.js';

describe('resolveFeatureAvailability', () => {
  it('keeps all capabilities available by default', () => {
    expect(resolveFeatureAvailability(undefined)).toEqual({
      research: true,
      messageDigests: true,
      prTriage: true,
      schedulers: true,
    });
  });

  it('marks unavailable Home capabilities without exposing private configuration', () => {
    expect(resolveFeatureAvailability('basic')).toEqual({
      research: false,
      messageDigests: false,
      prTriage: false,
      schedulers: false,
    });
  });

  it('rejects unknown public values', () => {
    expect(() => resolveFeatureAvailability('private')).toThrow(/Invalid public deployment/u);
  });
});
