export function resolveBuildDate(sourceDateEpoch: string | undefined): string {
  if (sourceDateEpoch === undefined || sourceDateEpoch === '') return new Date().toISOString();
  if (!/^(0|[1-9][0-9]*)$/u.test(sourceDateEpoch)) {
    throw new Error('SOURCE_DATE_EPOCH must be a non-negative integer');
  }
  const seconds = Number(sourceDateEpoch);
  if (!Number.isSafeInteger(seconds)) throw new Error('SOURCE_DATE_EPOCH is outside the safe range');
  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime())) throw new Error('SOURCE_DATE_EPOCH is not a valid date');
  return date.toISOString();
}
