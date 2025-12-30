/**
 * Phone number utility functions for WhatsApp inbox domain.
 */

/**
 * Normalize phone number to consistent format for storage and comparison.
 *
 * Storage format: digits only, no "+" prefix (e.g., "48123456789")
 *
 * This ensures:
 * - User saves "+48123456789" → stored as "48123456789"
 * - Webhook sends "48123456789" → matches stored "48123456789"
 *
 * @example normalizePhoneNumber("+48123456789") => "48123456789"
 * @example normalizePhoneNumber("48123456789") => "48123456789"
 * @example normalizePhoneNumber("+1-555-123-4567") => "15551234567"
 */
export function normalizePhoneNumber(phoneNumber: string): string {
  // Remove all non-digit characters (including +, spaces, dashes, parentheses)
  return phoneNumber.replace(/\D/g, '');
}
