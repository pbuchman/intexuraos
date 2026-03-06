import { describe, it, expect, vi } from 'vitest';

vi.mock('@speechmatics/batch-client', () => ({
  BatchClient: class MockBatchClient {
    createTranscriptionJob = vi.fn();
    getJob = vi.fn();
    getJobResult = vi.fn();
  },
}));

import { createTranscriptionProvider } from '../../providers/provider-factory.js';
import { SpeechmaticsTranscriptionAdapter } from '../../providers/speechmatics/adapter.js';

const mockLogger = {
  level: 'info',
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

describe('createTranscriptionProvider', () => {
  it('creates SpeechmaticsTranscriptionAdapter for speechmatics provider', () => {
    const provider = createTranscriptionProvider('speechmatics', 'test-api-key', mockLogger);
    expect(provider).toBeInstanceOf(SpeechmaticsTranscriptionAdapter);
  });

  it('creates SpeechmaticsTranscriptionAdapter for unknown provider (default fallback)', () => {
    const provider = createTranscriptionProvider('whisper', 'test-api-key', mockLogger);
    expect(provider).toBeInstanceOf(SpeechmaticsTranscriptionAdapter);
  });

  it('logs warning for unknown provider', () => {
    vi.clearAllMocks();
    createTranscriptionProvider('unknown-provider', 'test-api-key', mockLogger);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      { event: 'unknown_provider', providerName: 'unknown-provider' },
      'Unknown transcription provider, defaulting to Speechmatics'
    );
  });

  it('creates SpeechmaticsTranscriptionAdapter for empty provider string', () => {
    const provider = createTranscriptionProvider('', 'test-api-key', mockLogger);
    expect(provider).toBeInstanceOf(SpeechmaticsTranscriptionAdapter);
  });
});
