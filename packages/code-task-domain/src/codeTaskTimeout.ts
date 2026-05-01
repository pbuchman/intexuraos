/**
 * Bounds for the user-overridable code-task execution timeout.
 *
 * The orchestrator's intrinsic default (when no override is provided)
 * is `DEFAULT_TIMEOUT_HOURS = 5`. Users can choose any integer hour
 * value in the inclusive range [`MIN_TIMEOUT_HOURS`, `MAX_TIMEOUT_HOURS`]
 * via the New Code Task UI slider (INT-1585).
 */
export const MIN_TIMEOUT_HOURS = 1;
export const MAX_TIMEOUT_HOURS = 12;
export const DEFAULT_TIMEOUT_HOURS = 5;

export function isValidTimeoutHours(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MIN_TIMEOUT_HOURS &&
    value <= MAX_TIMEOUT_HOURS
  );
}

export function timeoutHoursToMs(hours: number): number {
  return hours * 60 * 60 * 1000;
}
