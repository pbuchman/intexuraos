import { describe, expect, it, vi } from 'vitest';
import type { MessageDigestWhatsAppClient } from '../ports/messageDigestClients.js';
import { getMessageDigestDeliveryReadiness } from './getMessageDigestDeliveryReadiness.js';

describe('getMessageDigestDeliveryReadiness', () => {
  it('returns the display-safe current observation', async () => {
    const getDeliveryReadiness = vi.fn<MessageDigestWhatsAppClient['getDeliveryReadiness']>(
      async () => ({
        ok: true,
        value: {
          status: 'ready',
          maskedPrimaryNumber: '+48•••123',
          observationVersion: 'readiness-v1',
          observedAt: '2026-07-27T12:00:00.000Z',
        },
      })
    );

    await expect(
      getMessageDigestDeliveryReadiness(
        { userId: 'synthetic-user-001' },
        { whatsappClient: { getDeliveryReadiness } }
      )
    ).resolves.toEqual({
      ok: true,
      readiness: {
        status: 'ready',
        maskedPrimaryNumber: '+48•••123',
        observationVersion: 'readiness-v1',
        observedAt: '2026-07-27T12:00:00.000Z',
      },
    });
  });

  it('maps downstream failures without leaking details', async () => {
    const getDeliveryReadiness = vi.fn<MessageDigestWhatsAppClient['getDeliveryReadiness']>(
      async () => ({
        ok: false,
        code: 'unavailable',
      })
    );
    await expect(
      getMessageDigestDeliveryReadiness(
        { userId: 'synthetic-user-001' },
        { whatsappClient: { getDeliveryReadiness } }
      )
    ).resolves.toEqual({ ok: false, code: 'READINESS_UNAVAILABLE' });
  });

  it('rejects a blank owner before calling WhatsApp', async () => {
    const getDeliveryReadiness = vi.fn<MessageDigestWhatsAppClient['getDeliveryReadiness']>();

    await expect(
      getMessageDigestDeliveryReadiness(
        { userId: '   ' },
        { whatsappClient: { getDeliveryReadiness } }
      )
    ).resolves.toEqual({ ok: false, code: 'INVALID_REQUEST' });
    expect(getDeliveryReadiness).not.toHaveBeenCalled();
  });
});
