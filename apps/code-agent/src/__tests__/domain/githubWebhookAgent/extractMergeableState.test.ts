import { describe, it, expect } from 'vitest';
import { extractMergeableState } from '../../../domain/githubWebhookAgent/eventFamilies/pullRequest.js';

describe('extractMergeableState', () => {
  it('extracts mergeable_state from valid payload', () => {
    const payload = { pull_request: { mergeable_state: 'dirty' } };
    expect(extractMergeableState(payload)).toBe('dirty');
  });

  it('returns null for null payload', () => {
    expect(extractMergeableState(null)).toBeNull();
  });

  it('returns null for non-object payload', () => {
    expect(extractMergeableState('string')).toBeNull();
  });

  it('returns null when pull_request is missing', () => {
    expect(extractMergeableState({})).toBeNull();
  });

  it('returns null when pull_request is not an object', () => {
    expect(extractMergeableState({ pull_request: 'invalid' })).toBeNull();
  });

  it('returns null when mergeable_state is not a string', () => {
    expect(extractMergeableState({ pull_request: { mergeable_state: 123 } })).toBeNull();
  });

  it('returns null when mergeable_state is missing', () => {
    expect(extractMergeableState({ pull_request: {} })).toBeNull();
  });
});
