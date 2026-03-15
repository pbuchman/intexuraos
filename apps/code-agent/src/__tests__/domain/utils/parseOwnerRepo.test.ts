import { describe, expect, it } from 'vitest';
import { parseOwnerRepo } from '../../../domain/utils/parseOwnerRepo.js';

describe('parseOwnerRepo', () => {
  it('parses a valid owner/repo string', () => {
    expect(parseOwnerRepo('intexuraos/code-agent')).toEqual({
      owner: 'intexuraos',
      repo: 'code-agent',
    });
  });

  it('returns null for invalid repository strings', () => {
    expect(parseOwnerRepo('invalid')).toBeNull();
    expect(parseOwnerRepo('owner/repo/extra')).toBeNull();
    expect(parseOwnerRepo('/repo')).toBeNull();
    expect(parseOwnerRepo('owner/')).toBeNull();
  });
});
