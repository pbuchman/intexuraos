import { describe, expect, it, vi } from 'vitest';
import { BackfillPrivateWhatsAppStoredMediaUseCase } from '../../domain/whatsapp/index.js';
import type { Logger } from '../../domain/whatsapp/utils/logger.js';
import { publishPrivateStoredMediaTranscriptionRequest } from '../../domain/whatsapp/usecases/privateStoredMediaTranscription.js';
import { FakeEventPublisher, FakePrivateWhatsAppRepository } from '../fakes.js';

const logger: Logger = {
  info: (): void => undefined,
  error: (): void => undefined,
};

describe('BackfillPrivateWhatsAppStoredMediaUseCase', () => {
  it('rejects stored media backfill without a GCS path before repository mutation', async () => {
    const repository = new FakePrivateWhatsAppRepository();
    const useCase = new BackfillPrivateWhatsAppStoredMediaUseCase({
      privateWhatsAppRepository: repository,
      eventPublisher: new FakeEventPublisher(),
    });

    const result = await useCase.execute(
      {
        sourceAccountId: 'pbuchman-private-whatsapp',
        messageId: 'message:pbuchman-private-whatsapp:$event-without-path',
        media: {
          mxcUri: 'mxc://home-dev/audio-without-path',
          storageStatus: 'stored',
        },
      },
      logger
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected missing GCS path to fail');
    expect(result.error.code).toBe('VALIDATION_ERROR');
    expect(repository.getAll()).toEqual([]);
  });

  it('returns the publisher error when private stored media transcription publishing fails', async () => {
    const eventPublisher = new FakeEventPublisher();
    const error = vi.fn();
    eventPublisher.setAudioStoredFailure('Simulated audio publish failure');

    const result = await publishPrivateStoredMediaTranscriptionRequest({
      sourceAccountId: 'pbuchman-private-whatsapp',
      userId: 'user-123',
      messageId: 'message:pbuchman-private-whatsapp:$event-audio-publish-failure',
      matrixEventId: '$event-audio-publish-failure',
      messageType: 'audio',
      media: {
        mxcUri: 'mxc://home-dev/audio-publish-failure',
        storageStatus: 'stored',
        gcsPath: 'whatsapp/private/user-123/audio-publish-failure/audio.ogg',
        storedMimeType: 'audio/ogg',
      },
      chatTranscriptionEnabled: true,
      eventPublisher,
      logger: {
        info: (): void => undefined,
        error,
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected publish failure to fail');
    expect(result.error.code).toBe('INTERNAL_ERROR');
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({
        mediaKind: 'audio',
        messageId: 'message:pbuchman-private-whatsapp:$event-audio-publish-failure',
      }),
      'Failed to publish private WhatsApp media transcription event'
    );
  });
});
