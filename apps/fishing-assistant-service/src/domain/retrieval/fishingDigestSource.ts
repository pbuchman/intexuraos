export const FISHING_LEGACY_GROUP_KEY = 'grupa-wedkarska-skool';
export const FISHING_DIGEST_DISPLAY_NAME = 'Grupa Wędkarska Skool';
export const FISHING_DIGEST_TIME_ZONE = 'Europe/Warsaw';

export function isValidFishingLocalDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}
