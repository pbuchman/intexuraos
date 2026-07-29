import { createHmac } from 'node:crypto';
import { err, ok, type Result } from '@intexuraos/common-core';
import type { WhatsAppError } from '../models/error.js';
import type { WhatsAppUserMappingRepository } from '../ports/repositories.js';
import type {
  WhatsAppDeliveryReadiness,
  WhatsAppDeliveryReadinessPort,
} from '../ports/whatsappDeliveryReadiness.js';

export interface WhatsAppDeliveryReadinessDeps {
  mappingRepository: Pick<WhatsAppUserMappingRepository, 'getMapping'>;
  deliveryEnabled(userId: string): Promise<Result<boolean, WhatsAppError>>;
  observationSecret: string;
  now(): string;
}

export function createWhatsAppDeliveryReadiness(
  deps: WhatsAppDeliveryReadinessDeps
): WhatsAppDeliveryReadinessPort {
  return {
    async getReadiness(userId: string): Promise<Result<WhatsAppDeliveryReadiness, WhatsAppError>> {
      if (userId.trim().length === 0) {
        return err({ code: 'VALIDATION_ERROR', message: 'User id is required' });
      }
      const mappingResult = await deps.mappingRepository.getMapping(userId);
      if (!mappingResult.ok) return mappingResult;
      const mapping = mappingResult.value;
      const observedAt = deps.now();

      if (mapping?.phoneNumbers[0] === undefined) {
        return ok(
          statusWithoutNumber(
            'mapping_missing',
            observedAt,
            observationVersion(deps.observationSecret, {
              userId,
              status: 'mapping_missing',
              updatedAt: mapping?.updatedAt ?? '',
              primaryNumber: '',
            })
          )
        );
      }
      const primaryNumber = mapping.phoneNumbers[0];
      if (!mapping.connected) {
        return ok(
          statusWithoutNumber(
            'disconnected',
            observedAt,
            observationVersion(deps.observationSecret, {
              userId,
              status: 'disconnected',
              updatedAt: mapping.updatedAt,
              primaryNumber,
            })
          )
        );
      }
      const enabledResult = await deps.deliveryEnabled(userId);
      if (!enabledResult.ok) return enabledResult;
      if (!enabledResult.value) {
        return ok(
          statusWithoutNumber(
            'delivery_disabled',
            observedAt,
            observationVersion(deps.observationSecret, {
              userId,
              status: 'delivery_disabled',
              updatedAt: mapping.updatedAt,
              primaryNumber,
            })
          )
        );
      }
      return ok({
        status: 'ready',
        maskedPrimaryNumber: maskPrimaryNumber(primaryNumber),
        observationVersion: observationVersion(deps.observationSecret, {
          userId,
          status: 'ready',
          updatedAt: mapping.updatedAt,
          primaryNumber,
        }),
        observedAt,
      });
    },
  };
}

function statusWithoutNumber(
  status: 'mapping_missing' | 'disconnected' | 'delivery_disabled',
  observedAt: string,
  version: string
): WhatsAppDeliveryReadiness {
  return { status, observationVersion: version, observedAt };
}

function observationVersion(
  secret: string,
  input: {
    userId: string;
    status: WhatsAppDeliveryReadiness['status'];
    updatedAt: string;
    primaryNumber: string;
  }
): string {
  return createHmac('sha256', secret)
    .update(
      [
        'whatsapp-delivery-readiness-v1',
        input.userId,
        input.status,
        input.updatedAt,
        input.primaryNumber,
      ].join('\0'),
      'utf8'
    )
    .digest('hex');
}

function maskPrimaryNumber(phoneNumber: string): string {
  return `••••${phoneNumber.slice(-4)}`;
}
