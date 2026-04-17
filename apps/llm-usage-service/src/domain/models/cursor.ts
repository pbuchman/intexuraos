export interface CursorPayload {
  lastSortValue: string | number;
  lastEventId: string;
}

export function encodeCursor(lastSortValue: string | number, lastEventId: string): string {
  const payload = JSON.stringify({ lastSortValue, lastEventId });
  return Buffer.from(payload).toString('base64url');
}

export function decodeCursor(cursor: string): CursorPayload | null {
  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf-8');
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== 'object' || parsed === null) {
      return null;
    }
    const record = parsed as Record<string, unknown>;
    const lastSortValue = record['lastSortValue'];
    const lastEventId = record['lastEventId'];
    if (
      (typeof lastSortValue !== 'string' && typeof lastSortValue !== 'number') ||
      typeof lastEventId !== 'string'
    ) {
      return null;
    }
    return { lastSortValue, lastEventId };
  } catch {
    return null;
  }
}
