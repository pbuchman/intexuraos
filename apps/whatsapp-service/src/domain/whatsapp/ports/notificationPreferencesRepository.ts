/**
 * NotificationPreferencesRepository port.
 *
 * Owns read/write access to per-user notification level preferences. This
 * port is consumed only within whatsapp-service — the field is private
 * and not exposed to other services.
 */
import type { Result } from '@intexuraos/common-core';
import type { WhatsAppError } from '../models/error.js';
import type {
  NotificationLevel,
  NotificationPreferences,
} from '../models/NotificationPreferences.js';

export interface NotificationPreferencesRepository {
  getPreferences(userId: string): Promise<Result<NotificationPreferences, WhatsAppError>>;
  savePreferences(
    userId: string,
    level: NotificationLevel
  ): Promise<Result<NotificationPreferences, WhatsAppError>>;
}
