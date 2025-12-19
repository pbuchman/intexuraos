import { describe, it, expect } from 'vitest';
import { NOTION_ERROR_CODES, isNotionErrorCode } from '../notionErrorCode.js';

describe('notionErrorCode', () => {
  it('exports the supported codes', () => {
    expect(NOTION_ERROR_CODES).toContain('UNAUTHORIZED');
    expect(NOTION_ERROR_CODES).toContain('NOT_FOUND');
  });

  it('isNotionErrorCode returns true only for known codes', () => {
    expect(isNotionErrorCode('UNAUTHORIZED')).toBe(true);
    expect(isNotionErrorCode('SOMETHING_ELSE')).toBe(false);
  });
});
