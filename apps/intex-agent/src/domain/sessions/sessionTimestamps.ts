export function normalizeSessionTimestamp(value: string): string {
  const parsed = parseSessionTimestamp(value);
  return parsed?.toISOString() ?? value;
}

export function getSessionTimestampMs(value: string): number {
  return parseSessionTimestamp(value)?.getTime() ?? Number.NaN;
}

function parseSessionTimestamp(value: string): Date | null {
  const trimmed = value.trim();
  if (trimmed === '') {
    return null;
  }

  if (/^\d+$/.test(trimmed)) {
    const epoch = Number(trimmed);
    if (Number.isSafeInteger(epoch)) {
      const millis = trimmed.length <= 10 ? epoch * 1000 : epoch;
      const date = new Date(millis);
      if (!Number.isNaN(date.getTime())) {
        return date;
      }
    }
  }

  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : date;
}
