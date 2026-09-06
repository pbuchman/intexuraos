import { describe, expect, it } from 'vitest';

import { isRebaseClean, parseCodeTaskRebaseResult } from '../rebaseResult.js';

describe('parseCodeTaskRebaseResult', () => {
  it('preserves not-required evidence when no rebase was attempted', () => {
    expect(parseCodeTaskRebaseResult({ attempted: false })).toEqual({
      attempted: false,
      reason: 'not_required',
    });
  });

  it('preserves successful rebase evidence', () => {
    expect(parseCodeTaskRebaseResult({ attempted: true, success: true })).toEqual({
      attempted: true,
      success: true,
      conflictFiles: [],
    });
  });

  it('preserves conflict files for failed rebase evidence', () => {
    expect(
      parseCodeTaskRebaseResult({
        attempted: true,
        success: false,
        conflictFiles: ['apps/web/src/App.tsx'],
      })
    ).toEqual({
      attempted: true,
      success: false,
      conflictFiles: ['apps/web/src/App.tsx'],
    });
  });

  it('maps legacy string values for backward compatibility', () => {
    expect(parseCodeTaskRebaseResult('skipped')).toEqual({
      attempted: false,
      reason: 'not_required',
    });
    expect(parseCodeTaskRebaseResult('success')).toEqual({
      attempted: true,
      success: true,
      conflictFiles: [],
    });
    expect(parseCodeTaskRebaseResult('conflict')).toEqual({
      attempted: true,
      success: false,
      conflictFiles: [],
    });
  });

  it('rejects malformed rebase evidence', () => {
    expect(parseCodeTaskRebaseResult(null)).toBeUndefined();
    expect(parseCodeTaskRebaseResult(42)).toBeUndefined();
    expect(parseCodeTaskRebaseResult({ attempted: true })).toBeUndefined();
    expect(parseCodeTaskRebaseResult({ attempted: true, success: 'yes' })).toBeUndefined();
    expect(parseCodeTaskRebaseResult({ attempted: false, success: true })).toBeUndefined();
    expect(
      parseCodeTaskRebaseResult({ attempted: true, success: false, conflictFiles: 'x.ts' })
    ).toBeUndefined();
    expect(
      parseCodeTaskRebaseResult({ attempted: true, success: false, conflictFiles: [42] })
    ).toBeUndefined();
  });
});

describe('isRebaseClean', () => {
  it('treats not-required and successful rebase as clean', () => {
    expect(isRebaseClean({ attempted: false, reason: 'not_required' })).toBe(true);
    expect(isRebaseClean({ attempted: true, success: true, conflictFiles: [] })).toBe(true);
  });

  it('does not treat conflicts or absent evidence as clean', () => {
    expect(isRebaseClean({ attempted: true, success: false, conflictFiles: ['x.ts'] })).toBe(false);
    expect(isRebaseClean(undefined)).toBe(false);
  });
});
