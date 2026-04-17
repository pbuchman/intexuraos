import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getUsageEvent } from '../../../domain/usecases/getUsageEvent.js';
import { FakeUsageEventRepository } from '../../fakeUsageEventRepository.js';
import { createTestEvent } from '../../helpers.js';

describe('getUsageEvent', () => {
  let eventRepo: FakeUsageEventRepository;
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn() } as never;

  beforeEach(() => {
    eventRepo = new FakeUsageEventRepository();
    vi.clearAllMocks();
  });

  it('returns the event when found', async () => {
    const event = createTestEvent({ eventId: 'evt_found' });
    await eventRepo.createEvent(event);

    const result = await getUsageEvent(
      { logger, usageEventRepository: eventRepo },
      'evt_found',
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).not.toBeNull();
      expect(result.value?.eventId).toBe('evt_found');
    }
  });

  it('returns null when event not found', async () => {
    const result = await getUsageEvent(
      { logger, usageEventRepository: eventRepo },
      'evt_nonexistent',
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBeNull();
    }
  });

  it('propagates repository errors', async () => {
    eventRepo.setFailure({ code: 'INTERNAL', message: 'DB down' });

    const result = await getUsageEvent(
      { logger, usageEventRepository: eventRepo },
      'evt_any',
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INTERNAL');
      expect(result.error.message).toBe('DB down');
    }
  });

  it('logs error on repository failure', async () => {
    eventRepo.setFailure({ code: 'TIMEOUT', message: 'timed out' });

    await getUsageEvent(
      { logger, usageEventRepository: eventRepo },
      'evt_err',
    );

    expect((logger as { error: ReturnType<typeof vi.fn> }).error).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: 'evt_err' }),
      'Failed to fetch usage event',
    );
  });

  it('logs info when event is found', async () => {
    const event = createTestEvent({ eventId: 'evt_log' });
    await eventRepo.createEvent(event);

    await getUsageEvent(
      { logger, usageEventRepository: eventRepo },
      'evt_log',
    );

    expect((logger as { info: ReturnType<typeof vi.fn> }).info).toHaveBeenCalledWith(
      { eventId: 'evt_log' },
      'Usage event retrieved',
    );
  });
});
