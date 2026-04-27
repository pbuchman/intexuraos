/**
 * Cursor encoding/decoding for issue group pagination.
 * Uses base64url-encoded JSON with an index field.
 */

import { IntexuraOSError } from '@intexuraos/common-core';

export function encodeCursor(index: number): string {
  return Buffer.from(JSON.stringify({ index })).toString('base64url');
}

export function decodeCursor(cursor: string): { index: number } {
  const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString()) as { index: unknown };
  if (typeof parsed.index !== 'number' || !Number.isInteger(parsed.index) || parsed.index < 0) {
    throw new IntexuraOSError('INVALID_REQUEST', 'Invalid cursor index');
  }
  return { index: parsed.index };
}
