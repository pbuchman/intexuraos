/**
 * API key masking utility.
 * Used to safely display API keys without exposing the full value.
 */

/**
 * Mask an API key for display.
 * Shows first 4 and last 4 characters with ellipsis in between.
 *
 * @example
 * maskApiKey('sk-1234567890abcdef') // returns 'sk-1...cdef'
 * maskApiKey('short') // returns '****'
 */
export function maskApiKey(key: string): string {
  if (key.length <= 8) return '****';
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}
