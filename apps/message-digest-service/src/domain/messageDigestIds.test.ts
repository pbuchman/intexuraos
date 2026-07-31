import { describe, expect, it } from 'vitest';
import { getMessageDigestDeliveryOutboxId } from './messageDigestIds.js';

describe('Message Digest IDs', () => {
  it('preserves the frozen deterministic WhatsApp delivery outbox ID', () => {
    expect(getMessageDigestDeliveryOutboxId('mdr_run_001')).toBe(
      'mdo_f130b4a4d80744d9509d02e17d4c87108b1a130a8edd392e'
    );
  });
});
