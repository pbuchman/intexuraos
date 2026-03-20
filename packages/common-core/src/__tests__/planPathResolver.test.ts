import { describe, it, expect } from 'vitest';
import { resolvePlanDocumentPathFromLinearContext } from '../planPathResolver.js';

describe('resolvePlanDocumentPathFromLinearContext', () => {
  it('prefers the canonical description reference', () => {
    const result = resolvePlanDocumentPathFromLinearContext({
      description: 'Plan document: docs/plans/INT-800-design.md',
      comments: [{ body: 'Plan document: docs/plans/INT-801-design.md' }],
    });

    expect(result).toBe('docs/plans/INT-800-design.md');
  });

  it('uses a canonical comment reference when description has none', () => {
    const result = resolvePlanDocumentPathFromLinearContext({
      description: 'No plan listed here',
      comments: [{ body: 'Plan document: docs/plans/INT-802-design.md' }],
    });

    expect(result).toBe('docs/plans/INT-802-design.md');
  });

  it('uses a plain description path when no canonical reference exists', () => {
    const result = resolvePlanDocumentPathFromLinearContext({
      description: 'Implementation notes reference docs/plans/INT-803-design.md for details',
      comments: [],
    });

    expect(result).toBe('docs/plans/INT-803-design.md');
  });

  it('uses a plain comment path when no description reference exists', () => {
    const result = resolvePlanDocumentPathFromLinearContext({
      description: undefined,
      comments: [{ body: 'See docs/plans/INT-804-design.md' }],
    });

    expect(result).toBe('docs/plans/INT-804-design.md');
  });

  it('returns undefined when comments contain no plan path', () => {
    const result = resolvePlanDocumentPathFromLinearContext({
      description: undefined,
      comments: [{ body: 'This comment references no design doc' }],
    });

    expect(result).toBeUndefined();
  });

  it('resolves plan paths from GitHub blob links in comments', () => {
    const result = resolvePlanDocumentPathFromLinearContext({
      description: undefined,
      comments: [
        {
          body: 'See https://github.com/pbuchman/intexuraos/blob/plan/INT-800/docs/plans/INT-800-design.md',
        },
      ],
    });

    expect(result).toBe('docs/plans/INT-800-design.md');
  });

  it('rejects invalid traversal paths', () => {
    const result = resolvePlanDocumentPathFromLinearContext({
      description: 'Plan document: docs/plans/../../secrets.md',
      comments: [],
    });

    expect(result).toBeUndefined();
  });
});
