import { Timestamp } from '@google-cloud/firestore';

/**
 * User spend tracking for rate limiting.
 * Design reference: Lines 2616-2671
 *
 * Collection: user_spend
 * Document ID: userId
 */
export interface UserSpend {
  userId: string;
  dailySpend: number;       // Current day's spend in dollars
  monthlySpend: number;     // Current month's spend in dollars
  dailyLimit: number;       // Default: 20
  monthlyLimit: number;     // Default: 200
  lastTaskDate: Timestamp;  // Date of last task (for daily reset)
  lastResetDate: Timestamp; // Date of last monthly reset
}
