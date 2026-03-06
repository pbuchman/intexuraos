import { describe, it, expect, vi } from 'vitest';

vi.mock('@speechmatics/batch-client', () => ({
  BatchClient: class MockBatchClient {
    createTranscriptionJob = vi.fn();
    getJob = vi.fn();
    getJobResult = vi.fn();
  },
}));

vi.mock('pino', () => ({
  default: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

import { createTranscriptionProvider } from '../../providers/provider-factory.js';
import { SpeechmaticsTranscriptionAdapter } from '../../providers/speechmatics/adapter.js';

describe('createTranscriptionProvider', () => {
  it('creates SpeechmaticsTranscriptionAdapter for speechmatics provider', () => {
    const provider = createTranscriptionProvider('speechmatics', 'test-api-key');
    expect(provider).toBeInstanceOf(SpeechmaticsTranscriptionAdapter);
  });

  it('creates SpeechmaticsTranscriptionAdapter for unknown provider (default fallback)', () => {
    const provider = createTranscriptionProvider('whisper', 'test-api-key');
    expect(provider).toBeInstanceOf(SpeechmaticsTranscriptionAdapter);
  });

  it('creates SpeechmaticsTranscriptionAdapter for empty provider string', () => {
    const provider = createTranscriptionProvider('', 'test-api-key');
    expect(provider).toBeInstanceOf(SpeechmaticsTranscriptionAdapter);
  });
});
