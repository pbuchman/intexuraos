/**
 * Creates a Result type for explicit error handling.
 * IntexuraOS follows "no dummy success" principle - failures must be explicit.
 */
export type Result<T, E = Error> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };
/**
 * Creates a successful Result.
 */
export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}
/**
 * Creates a failed Result.
 */
export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}
/**
 * Type guard to check if a Result is successful.
 */
export function isOk<T, E>(result: Result<T, E>): result is { ok: true; value: T } {
  return result.ok;
}
/**
 * Type guard to check if a Result is a failure.
 */
export function isErr<T, E>(result: Result<T, E>): result is { ok: false; error: E } {
  return !result.ok;
}
