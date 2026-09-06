import { describe, expect, it, vi } from 'vitest';
import { err, ok } from '@intexuraos/common-core';
import { createWhatsAppDeliveryReadiness } from '../../../domain/whatsapp/usecases/whatsappDeliveryReadiness.js';

const connectedMapping = {
  phoneNumbers: ['481112221234', '489998887777'],
  connected: true,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-27T10:00:00.000Z',
};

function readiness(
  mapping: typeof connectedMapping | null,
  enabled = true
): ReturnType<typeof createWhatsAppDeliveryReadiness> {
  return createWhatsAppDeliveryReadiness({
    mappingRepository: {
      getMapping: vi.fn().mockResolvedValue(ok(mapping)),
    },
    deliveryEnabled: vi.fn().mockResolvedValue(ok(enabled)),
    observationSecret: 'synthetic-observation-secret',
    now: (): string => '2026-07-27T12:00:00.000Z',
  });
}

describe('WhatsApp delivery readiness', () => {
  it('uses only the first mapped number and returns a non-reversible observation', async () => {
    const result = await readiness(connectedMapping).getReadiness('user-1');

    expect(result).toMatchObject({
      ok: true,
      value: {
        status: 'ready',
        maskedPrimaryNumber: '••••1234',
        observedAt: '2026-07-27T12:00:00.000Z',
      },
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.observationVersion).toMatch(/^[a-f0-9]{64}$/u);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('481112221234');
    expect(serialized).not.toContain('489998887777');
    expect(serialized).not.toContain('user-1');
  });

  it.each([
    { mapping: null, enabled: true, status: 'mapping_missing' },
    {
      mapping: { ...connectedMapping, phoneNumbers: [] },
      enabled: true,
      status: 'mapping_missing',
    },
    {
      mapping: { ...connectedMapping, connected: false },
      enabled: true,
      status: 'disconnected',
    },
    { mapping: connectedMapping, enabled: false, status: 'delivery_disabled' },
  ])('returns $status without a masked number', async ({ mapping, enabled, status }) => {
    const result = await readiness(mapping, enabled).getReadiness('user-1');
    expect(result).toMatchObject({ ok: true, value: { status } });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value).not.toHaveProperty('maskedPrimaryNumber');
  });

  it('validates the user id and propagates mapping and delivery-state failures', async () => {
    await expect(readiness(connectedMapping).getReadiness('   ')).resolves.toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_ERROR' },
    });

    const mappingFailure = createWhatsAppDeliveryReadiness({
      mappingRepository: {
        getMapping: vi
          .fn()
          .mockResolvedValue(err({ code: 'PERSISTENCE_ERROR', message: 'Safe mapping failure' })),
      },
      deliveryEnabled: vi.fn(),
      observationSecret: 'synthetic-observation-secret',
      now: (): string => '2026-07-27T12:00:00.000Z',
    });
    await expect(mappingFailure.getReadiness('user-1')).resolves.toEqual(
      err({ code: 'PERSISTENCE_ERROR', message: 'Safe mapping failure' })
    );

    const deliveryFailure = createWhatsAppDeliveryReadiness({
      mappingRepository: {
        getMapping: vi.fn().mockResolvedValue(ok(connectedMapping)),
      },
      deliveryEnabled: vi
        .fn()
        .mockResolvedValue(err({ code: 'INTERNAL_ERROR', message: 'Safe delivery failure' })),
      observationSecret: 'synthetic-observation-secret',
      now: (): string => '2026-07-27T12:00:00.000Z',
    });
    await expect(deliveryFailure.getReadiness('user-1')).resolves.toEqual(
      err({ code: 'INTERNAL_ERROR', message: 'Safe delivery failure' })
    );
  });
});
