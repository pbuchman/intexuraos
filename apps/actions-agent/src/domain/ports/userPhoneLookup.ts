/**
 * Port for looking up user phone numbers.
 * Used to send WhatsApp notifications to users.
 */
export interface UserPhoneLookup {
  /**
   * Get user's WhatsApp phone number.
   * Returns null if user doesn't have WhatsApp connected.
   * @param userId User ID
   * @returns E.164 format phone number or null
   */
  getPhoneNumber(userId: string): Promise<string | null>;
}
