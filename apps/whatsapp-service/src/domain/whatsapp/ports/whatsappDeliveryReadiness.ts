import type { Result } from '@intexuraos/common-core';
import type { WhatsAppError } from '../models/error.js';

export type WhatsAppDeliveryReadiness =
  | {
      status: 'ready';
      maskedPrimaryNumber: string;
      observationVersion: string;
      observedAt: string;
    }
  | {
      status: 'mapping_missing' | 'disconnected' | 'delivery_disabled';
      observationVersion: string;
      observedAt: string;
    };

export interface WhatsAppDeliveryReadinessPort {
  getReadiness(userId: string): Promise<Result<WhatsAppDeliveryReadiness, WhatsAppError>>;
}
