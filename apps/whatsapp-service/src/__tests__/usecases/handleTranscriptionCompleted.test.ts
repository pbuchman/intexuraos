/**
 * Tests for HandleTranscriptionCompletedUseCase.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import pino from 'pino';
import type { WhatsAppMessage } from '../../domain/whatsapp/index.js';
import {
  HandleTranscriptionCompletedUseCase,
  type HandleTranscriptionCompletedDeps,
} from '../../domain/whatsapp/usecases/handleTranscriptionCompleted.js';
import {
  FakeEventPublisher,
  FakeWhatsAppCloudApiPort,
  FakeWhatsAppMessageRepository,
} from '../fakes.js';

const logger = pino({ level: 'silent' });

function createTestMessage(overrides?: Partial<WhatsAppMessage>): WhatsAppMessage {
  return {
    id: 'msg-1',
    userId: 'user-1',
    waMessageId: 'wamid.test',
    fromNumber: '+1234567890',
    toNumber: '+0987654321',
    text: '',
    mediaType: 'audio',
    timestamp: '1703673600',
    receivedAt: new Date().toISOString(),
    webhookEventId: 'event-1',
    metadata: { phoneNumberId: 'phone-123' },
    ...overrides,
  };
}

describe('HandleTranscriptionCompletedUseCase', () => {
  let messageRepository: FakeWhatsAppMessageRepository;
  let whatsappCloudApi: FakeWhatsAppCloudApiPort;
  let eventPublisher: FakeEventPublisher;
  let usecase: HandleTranscriptionCompletedUseCase;
  let deps: HandleTranscriptionCompletedDeps;

  beforeEach(() => {
    messageRepository = new FakeWhatsAppMessageRepository();
    whatsappCloudApi = new FakeWhatsAppCloudApiPort();
    eventPublisher = new FakeEventPublisher();
    deps = {
      messageRepository,
      whatsappCloudApi,
      eventPublisher,
    };
    usecase = new HandleTranscriptionCompletedUseCase(deps);
  });

  it('handles completed status: updates transcription, sends WhatsApp message with transcript, publishes command.ingest', async () => {
    messageRepository.setMessage(createTestMessage());

    await usecase.execute(
      {
        type: 'srt.transcription.completed',
        userId: 'user-1',
        messageId: 'msg-1',
        jobId: 'job-1',
        status: 'completed',
        transcript: 'Hello world',
        timestamp: new Date().toISOString(),
      },
      logger
    );

    const savedMessage = messageRepository.getMessageSync('msg-1');
    expect(savedMessage?.transcription?.status).toBe('completed');
    expect(savedMessage?.transcription?.text).toBe('Hello world');

    const sentMessages = whatsappCloudApi.getSentMessages();
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]?.message).toContain('🎙️ *Transcription:*');
    expect(sentMessages[0]?.message).toContain('Hello world');

    const commandIngestEvents = eventPublisher.getCommandIngestEvents();
    expect(commandIngestEvents).toHaveLength(1);
    expect(commandIngestEvents[0]?.userId).toBe('user-1');
    expect(commandIngestEvents[0]?.text).toBe('Hello world');
    expect(commandIngestEvents[0]?.sourceType).toBe('whatsapp_voice');
  });

  it('handles failed status: updates transcription, sends failure message, does NOT publish command.ingest', async () => {
    messageRepository.setMessage(createTestMessage());

    await usecase.execute(
      {
        type: 'srt.transcription.completed',
        userId: 'user-1',
        messageId: 'msg-1',
        jobId: 'job-1',
        status: 'failed',
        error: 'Audio quality too low',
        timestamp: new Date().toISOString(),
      },
      logger
    );

    const savedMessage = messageRepository.getMessageSync('msg-1');
    expect(savedMessage?.transcription?.status).toBe('failed');

    const sentMessages = whatsappCloudApi.getSentMessages();
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]?.message).toContain('❌ *Transcription failed:*');
    expect(sentMessages[0]?.message).toContain('Audio quality too low');

    const commandIngestEvents = eventPublisher.getCommandIngestEvents();
    expect(commandIngestEvents).toHaveLength(0);
  });

  it('includes summary in WhatsApp message when provided (English)', async () => {
    messageRepository.setMessage(createTestMessage());

    await usecase.execute(
      {
        type: 'srt.transcription.completed',
        userId: 'user-1',
        messageId: 'msg-1',
        jobId: 'job-1',
        status: 'completed',
        transcript: 'Hello world',
        summary: 'Key point 1',
        detectedLanguage: 'en',
        timestamp: new Date().toISOString(),
      },
      logger
    );

    const sentMessages = whatsappCloudApi.getSentMessages();
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]?.message).toContain('📝 *Summary:*');
    expect(sentMessages[0]?.message).toContain('Here are the key points from your voice message:');
  });

  it('includes summary in WhatsApp message with Polish intro when detectedLanguage is pl', async () => {
    messageRepository.setMessage(createTestMessage());

    await usecase.execute(
      {
        type: 'srt.transcription.completed',
        userId: 'user-1',
        messageId: 'msg-1',
        jobId: 'job-1',
        status: 'completed',
        transcript: 'Cześć',
        summary: 'Kluczowy punkt',
        detectedLanguage: 'pl',
        timestamp: new Date().toISOString(),
      },
      logger
    );

    const sentMessages = whatsappCloudApi.getSentMessages();
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]?.message).toContain('📝 *Summary:*');
    expect(sentMessages[0]?.message).toContain(
      'Oto kluczowe punkty z Twojej wiadomości głosowej:'
    );
  });

  it('strips markdown headers from summary', async () => {
    messageRepository.setMessage(createTestMessage());

    await usecase.execute(
      {
        type: 'srt.transcription.completed',
        userId: 'user-1',
        messageId: 'msg-1',
        jobId: 'job-1',
        status: 'completed',
        transcript: 'Hello',
        summary: '### Key Points\nPoint 1\n## Important\nPoint 2',
        timestamp: new Date().toISOString(),
      },
      logger
    );

    const sentMessages = whatsappCloudApi.getSentMessages();
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]?.message).not.toContain('###');
    expect(sentMessages[0]?.message).not.toContain('##');
    expect(sentMessages[0]?.message).toContain('Key Points');
    expect(sentMessages[0]?.message).toContain('Important');
  });

  it('returns early when message not found (null)', async () => {
    // No message set in repository — findById returns null

    await usecase.execute(
      {
        type: 'srt.transcription.completed',
        userId: 'user-1',
        messageId: 'msg-1',
        jobId: 'job-1',
        status: 'completed',
        transcript: 'Hello world',
        timestamp: new Date().toISOString(),
      },
      logger
    );

    expect(whatsappCloudApi.getSentMessages()).toHaveLength(0);
    expect(eventPublisher.getCommandIngestEvents()).toHaveLength(0);
  });

  it('returns early when findById returns an error result', async () => {
    messageRepository.setFailFindById(true);

    await usecase.execute(
      {
        type: 'srt.transcription.completed',
        userId: 'user-1',
        messageId: 'msg-1',
        jobId: 'job-1',
        status: 'completed',
        transcript: 'Hello world',
        timestamp: new Date().toISOString(),
      },
      logger
    );

    expect(whatsappCloudApi.getSentMessages()).toHaveLength(0);
    expect(eventPublisher.getCommandIngestEvents()).toHaveLength(0);
  });

  it('uses empty string when phoneNumberId is not in message metadata', async () => {
    // Create message without metadata to exercise the `metadata?.phoneNumberId ?? ''` fallback
    const messageWithoutMetadata: WhatsAppMessage = {
      id: 'msg-1',
      userId: 'user-1',
      waMessageId: 'wamid.test',
      fromNumber: '+1234567890',
      toNumber: '+0987654321',
      text: '',
      mediaType: 'audio',
      timestamp: '1703673600',
      receivedAt: new Date().toISOString(),
      webhookEventId: 'event-1',
    };
    messageRepository.setMessage(messageWithoutMetadata);

    await usecase.execute(
      {
        type: 'srt.transcription.completed',
        userId: 'user-1',
        messageId: 'msg-1',
        jobId: 'job-1',
        status: 'completed',
        transcript: 'Hello world',
        timestamp: new Date().toISOString(),
      },
      logger
    );

    const sentMessages = whatsappCloudApi.getSentMessages();
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]?.phoneNumberId).toBe('');
  });

  it('uses empty string for transcript when transcript is undefined (completed)', async () => {
    messageRepository.setMessage(createTestMessage());

    await usecase.execute(
      {
        type: 'srt.transcription.completed',
        userId: 'user-1',
        messageId: 'msg-1',
        jobId: 'job-1',
        status: 'completed',
        timestamp: new Date().toISOString(),
      },
      logger
    );

    const sentMessages = whatsappCloudApi.getSentMessages();
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]?.message).toContain('🎙️ *Transcription:*');

    const commandIngestEvents = eventPublisher.getCommandIngestEvents();
    expect(commandIngestEvents).toHaveLength(1);
    expect(commandIngestEvents[0]?.text).toBe('');
  });

  it('uses fallback error message when error is undefined (failed)', async () => {
    messageRepository.setMessage(createTestMessage());

    await usecase.execute(
      {
        type: 'srt.transcription.completed',
        userId: 'user-1',
        messageId: 'msg-1',
        jobId: 'job-1',
        status: 'failed',
        timestamp: new Date().toISOString(),
      },
      logger
    );

    const sentMessages = whatsappCloudApi.getSentMessages();
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]?.message).toContain('An error occurred during transcription');

    const savedMessage = messageRepository.getMessageSync('msg-1');
    expect(savedMessage?.transcription?.error?.message).toBe('Transcription failed');
  });
});
