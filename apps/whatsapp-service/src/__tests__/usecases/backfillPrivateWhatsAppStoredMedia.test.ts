import { describe, expect, it } from 'vitest';
import { err, ok, type Result } from '@intexuraos/common-core';
import {
  BackfillPrivateWhatsAppStoredMediaUseCase,
  type AudioStoredEvent,
  type EventPublisherPort,
  type MediaTranscriptionRequestedEvent,
  type PrivateWhatsAppChat,
  type PrivateWhatsAppMessage,
  type PrivateWhatsAppRepository,
  type UpdatePrivateWhatsAppMessageStoredMediaInput,
  type UpdatePrivateWhatsAppMessageStoredMediaResult,
  type WhatsAppError,
} from '../../domain/whatsapp/index.js';
import type { Logger } from '../../domain/whatsapp/utils/logger.js';

const logger: Logger = {
  info: (): void => undefined,
  error: (): void => undefined,
};

const chat: PrivateWhatsAppChat = {
  id: 'chat:pbuchman-private-whatsapp:!room',
  userId: 'user-123',
  sourceAccountId: 'pbuchman-private-whatsapp',
  matrixRoomId: '!room',
  chatType: 'direct',
  displayName: 'Alice',
  firstSeenAt: '2026-06-22T10:00:00.000Z',
  lastEventAt: '2026-06-22T10:00:00.000Z',
  messageCount: 1,
  transcriptionEnabled: true,
  updatedAt: '2026-06-22T10:00:00.000Z',
  schemaVersion: 1,
};

const message: PrivateWhatsAppMessage = {
  id: 'message:pbuchman-private-whatsapp:$event-1',
  chatId: chat.id,
  userId: 'user-123',
  sourceAccountId: 'pbuchman-private-whatsapp',
  matrixRoomId: '!room',
  matrixEventId: '$event-1',
  matrixSenderId: '@alice:matrix.example',
  direction: 'incoming',
  messageType: 'audio',
  eventTimestamp: '2026-06-22T10:00:00.000Z',
  eventDayKey: '2026-06-22',
  eventTimeZone: 'Europe/Warsaw',
  receivedAt: '2026-06-22T10:00:02.000Z',
  ingestedAt: '2026-06-22T10:00:03.000Z',
  deliveryMode: 'live',
  rawMatrixEvent: { type: 'm.room.message', event_id: '$event-1' },
  media: {
    mxcUri: 'mxc://home-dev/audio',
    storageStatus: 'stored',
    gcsPath: 'whatsapp/private/user-123/message/audio.ogg',
    storedMimeType: 'audio/ogg',
  },
  schemaVersion: 1,
};

function createUseCase(
  updateResult: Result<UpdatePrivateWhatsAppMessageStoredMediaResult, WhatsAppError>,
  publishResult: Result<void, WhatsAppError> = ok(undefined)
): BackfillPrivateWhatsAppStoredMediaUseCase {
  const repository = {
    updateMessageStoredMedia: (
      _input: UpdatePrivateWhatsAppMessageStoredMediaInput
    ): Promise<Result<UpdatePrivateWhatsAppMessageStoredMediaResult, WhatsAppError>> =>
      Promise.resolve(updateResult),
  } as Partial<PrivateWhatsAppRepository> as PrivateWhatsAppRepository;
  const eventPublisher = {
    publishAudioStored: (_event: AudioStoredEvent): Promise<Result<void, WhatsAppError>> =>
      Promise.resolve(publishResult),
    publishMediaTranscriptionRequested: (
      _event: MediaTranscriptionRequestedEvent
    ): Promise<Result<void, WhatsAppError>> => Promise.resolve(publishResult),
  } as Partial<EventPublisherPort> as EventPublisherPort;

  return new BackfillPrivateWhatsAppStoredMediaUseCase({
    privateWhatsAppRepository: repository,
    eventPublisher,
  });
}

describe('BackfillPrivateWhatsAppStoredMediaUseCase', () => {
  it('rejects stored media without a GCS path before repository writes', async () => {
    const useCase = createUseCase(
      ok({
        status: 'updated',
        message,
        chat,
      })
    );

    const result = await useCase.execute(
      {
        sourceAccountId: 'pbuchman-private-whatsapp',
        messageId: message.id,
        media: {
          mxcUri: 'mxc://home-dev/audio',
          storageStatus: 'stored',
        },
      },
      logger
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected missing GCS path to be rejected');
    expect(result.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns repository update failures', async () => {
    const useCase = createUseCase(
      err({ code: 'PERSISTENCE_ERROR', message: 'Failed to update stored media' })
    );

    const result = await useCase.execute(
      {
        sourceAccountId: 'pbuchman-private-whatsapp',
        messageId: message.id,
        media: {
          mxcUri: 'mxc://home-dev/audio',
          storageStatus: 'stored',
          gcsPath: 'whatsapp/private/user-123/message/audio.ogg',
        },
      },
      logger
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected repository failure');
    expect(result.error.code).toBe('PERSISTENCE_ERROR');
  });

  it('returns publish failures after updating stored media', async () => {
    const useCase = createUseCase(
      ok({
        status: 'updated',
        message,
        chat,
      }),
      err({ code: 'INTERNAL_ERROR', message: 'Failed to publish audio stored event' })
    );

    const result = await useCase.execute(
      {
        sourceAccountId: 'pbuchman-private-whatsapp',
        messageId: message.id,
        media: {
          mxcUri: 'mxc://home-dev/audio',
          storageStatus: 'stored',
          gcsPath: 'whatsapp/private/user-123/message/audio.ogg',
        },
      },
      logger
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected publish failure');
    expect(result.error.code).toBe('INTERNAL_ERROR');
  });
});
