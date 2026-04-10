export interface CursorPayload {
  lastOccurredAt: string;
  lastEventId: string;
}

export function encodeCursor(lastOccurredAt: string, lastEventId: string): string {
  const payload = JSON.stringify({ lastOccurredAt, lastEventId });
  return Buffer.from(payload).toString('base64url');
}

export function decodeCursor(cursor: string): CursorPayload | null {
  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf-8');
    const parsed: unknown = JSON.parse(json);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as Record<string, unknown>)['lastOccurredAt'] !== 'string' ||
      typeof (parsed as Record<string, unknown>)['lastEventId'] !== 'string'
    ) {
      return null;
    }
    return {
      lastOccurredAt: (parsed as CursorPayload).lastOccurredAt,
      lastEventId: (parsed as CursorPayload).lastEventId,
    };
  } catch {
    return null;
  }
}
