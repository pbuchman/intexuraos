/**
 * Helpers for the scheduled-dispatch UX on the new code task form.
 *
 * Responsibilities:
 * - Resolve the browser timezone with a safe UTC fallback.
 * - Convert between the `<input type="datetime-local">` wall-clock string and
 *   absolute ISO UTC strings that the backend persists.
 * - Produce the `Dispatches ...` live-preview label shown next to the control.
 */

/**
 * Resolve the browser timezone, falling back to 'UTC' on any failure.
 *
 * Uses `Intl.DateTimeFormat().resolvedOptions().timeZone`. Returns 'UTC' if the
 * call throws or resolves to a falsy value.
 */
export function getBrowserTimezone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (typeof tz === 'string' && tz.length > 0) {
      return tz;
    }
    return 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * Produce a `YYYY-MM-DDTHH:mm` string suitable for the `min` attribute or
 * `value` of an `<input type="datetime-local">`. Reflects local wall-clock.
 */
export function nowLocalInputValue(date: Date = new Date()): string {
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

/**
 * Parse a `YYYY-MM-DDTHH:mm` local wall-clock string into an absolute ISO UTC
 * timestamp. Returns null for empty/invalid inputs.
 */
export function localInputToIsoUtc(localDateTime: string): string | null {
  if (localDateTime.length === 0) return null;
  const parsed = new Date(localDateTime);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

/**
 * Build the `Dispatches Apr 24, 2026, 10:00 PM UTC` live-preview string for a
 * given absolute UTC ISO timestamp rendered in the provided timezone.
 */
export function formatSchedulePreview(isoUtc: string, timezone: string): string {
  const date = new Date(isoUtc);
  const formatted = date.toLocaleString('en-US', {
    timeZone: timezone,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
  return `Dispatches ${formatted}`;
}

/**
 * Returns true when `localDateTime` is a valid `YYYY-MM-DDTHH:mm` string whose
 * parsed wall-clock moment is strictly in the future relative to `now`.
 */
export function isFutureLocalDateTime(
  localDateTime: string,
  now: Date = new Date(),
): boolean {
  if (localDateTime.length === 0) return false;
  const parsed = new Date(localDateTime);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.getTime() > now.getTime();
}
