/**
 * Phone verification model for WhatsApp phone number ownership verification.
 */

export type PhoneVerificationStatus = 'pending' | 'verified' | 'expired' | 'max_attempts';

export interface PhoneVerification {
  id: string;
  userId: string;
  phoneNumber: string;
  code: string;
  attempts: number;
  status: PhoneVerificationStatus;
  createdAt: string;
  expiresAt: number;
  lastAttemptAt?: string;
  verifiedAt?: string;
}

export interface PhoneVerificationPublic {
  id: string;
  phoneNumber: string;
  status: PhoneVerificationStatus;
  attempts: number;
  createdAt: string;
  expiresAt: number;
  lastAttemptAt?: string;
  verifiedAt?: string;
}
