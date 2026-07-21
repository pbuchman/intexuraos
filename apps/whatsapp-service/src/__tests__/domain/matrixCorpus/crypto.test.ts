/* eslint-disable @typescript-eslint/explicit-function-return-type -- Parameterized test callbacks preserve Vitest inference. */
import { describe, expect, it } from 'vitest';

import {
  createMatrixCorpusKeyedDigests,
  createMatrixCorpusReplayProjectionDigest,
  createMatrixCorpusSha256,
} from '../../../domain/matrixCorpus/crypto.js';

describe('Matrix corpus production digests', () => {
  it('is deterministic, domain separated, and length-prefix separates parts', () => {
    const digests = createMatrixCorpusKeyedDigests('synthetic-hmac-key-material-32b');
    const first = digests.digest('imc-lease-slot-v1', ['ab', 'c']);

    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(digests.digest('imc-lease-slot-v1', ['ab', 'c'])).toBe(first);
    expect(digests.digest('imc-run-fence-v1', ['ab', 'c'])).not.toBe(first);
    expect(digests.digest('imc-lease-slot-v1', ['a', 'bc'])).not.toBe(first);
  });

  it('hashes canonical payload bytes without implicit mutation', () => {
    const sha256 = createMatrixCorpusSha256();

    expect(sha256.digestCanonical('{"a":1}')).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256.digestCanonical('{"a":1}')).not.toBe(
      sha256.digestCanonical('{ "a": 1 }')
    );
  });

  it('stably hashes every supported replay projection value independent of object key order', () => {
    const replay = createMatrixCorpusReplayProjectionDigest();
    const first = replay.digest({
      z: [null, true, false, 'text', 7],
      a: { nested: 'value' },
    } as never);

    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(
      replay.digest({ a: { nested: 'value' }, z: [null, true, false, 'text', 7] } as never)
    ).toBe(first);
    expect(replay.digest(['text', 7] as never)).not.toBe(replay.digest([7, 'text'] as never));
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'rejects non-finite replay projection number %s',
    (value) => {
      const replay = createMatrixCorpusReplayProjectionDigest();
      expect(() => replay.digest(value as never)).toThrow(
        'Non-finite Matrix corpus projection number'
      );
    }
  );

  it.each([undefined, Symbol('unsupported'), () => undefined])(
    'rejects unsupported replay projection value',
    (value) => {
      const replay = createMatrixCorpusReplayProjectionDigest();
      expect(() => replay.digest(value as never)).toThrow(
        'Unsupported Matrix corpus projection value'
      );
    }
  );
});
