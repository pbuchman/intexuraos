import { describe, expect, it, vi } from 'vitest';
import {
  createIntexAgentModelAvailability,
  type IntexAgentCatalogEvidenceProvider,
} from '../../../domain/settings/intexAgentModelAvailability.js';

const evidence = {} as Awaited<
  ReturnType<IntexAgentCatalogEvidenceProvider['getIntexAgentCatalogEvidence']>
>;

describe('IntexAgentModelAvailability', () => {
  it('starts once and grants availability only to the exact configured subject with conformant evidence', async () => {
    const catalogClient: IntexAgentCatalogEvidenceProvider = {
      start: vi.fn().mockResolvedValue(null),
      getIntexAgentCatalogEvidence: vi.fn().mockResolvedValue(evidence),
    };
    const availability = createIntexAgentModelAvailability({
      userId: 'eligible-test-user',
      catalogClient,
    });

    await availability.start();
    await availability.start();

    await expect(availability.isAvailableForUser('other-test-user')).resolves.toBe(false);
    await expect(availability.isAvailableForUser('eligible-test-user')).resolves.toBe(true);
    expect(catalogClient.start).toHaveBeenCalledTimes(1);
    expect(catalogClient.getIntexAgentCatalogEvidence).toHaveBeenCalledTimes(1);
  });

  it('fails closed at startup and on stale evidence, then recovers from a fresh conformant shared-client refresh', async () => {
    const catalogClient: IntexAgentCatalogEvidenceProvider = {
      start: vi.fn().mockRejectedValue(new Error('startup fetch failed')),
      getIntexAgentCatalogEvidence: vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(evidence),
    };
    const availability = createIntexAgentModelAvailability({
      userId: 'eligible-test-user',
      catalogClient,
    });

    await expect(availability.start()).resolves.toBeUndefined();
    await expect(availability.isAvailableForUser('eligible-test-user')).resolves.toBe(false);
    await expect(availability.isAvailableForUser('eligible-test-user')).resolves.toBe(true);
  });

  it('relies on one shared client for concurrent stale refresh callers', async () => {
    let refreshes = 0;
    let inFlight: Promise<typeof evidence> | null = null;
    const catalogClient: IntexAgentCatalogEvidenceProvider = {
      start: vi.fn().mockResolvedValue(null),
      getIntexAgentCatalogEvidence: vi.fn(async () => {
        if (inFlight === null) {
          refreshes += 1;
          inFlight = Promise.resolve(evidence).finally(() => {
            inFlight = null;
          });
        }
        return await inFlight;
      }),
    };
    const availability = createIntexAgentModelAvailability({
      userId: 'eligible-test-user',
      catalogClient,
    });

    await expect(
      Promise.all([
        availability.isAvailableForUser('eligible-test-user'),
        availability.isAvailableForUser('eligible-test-user'),
      ])
    ).resolves.toEqual([true, true]);
    expect(refreshes).toBe(1);
  });
});
