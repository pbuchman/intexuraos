/**
 * Use case for handling transcription completed events.
 *
 * Handles both successful transcription and failure cases:
 * - Updates Firestore message with transcription state
 * - Sends formatted WhatsApp message to the user
 * - Publishes command.ingest event on success
 */
import type { WhatsAppMessageRepository } from '../ports/repositories.js';
import type { WhatsAppCloudApiPort } from '../ports/whatsappCloudApi.js';
import type { EventPublisherPort } from '../ports/eventPublisher.js';
import type { TranscriptionCompletedEvent } from '../events/index.js';
import type { Logger } from '../utils/logger.js';

/**
 * Dependencies for HandleTranscriptionCompletedUseCase.
 */
export interface HandleTranscriptionCompletedDeps {
  messageRepository: WhatsAppMessageRepository;
  whatsappCloudApi: WhatsAppCloudApiPort;
  eventPublisher: EventPublisherPort;
}

/**
 * Get language-specific intro phrase for summary.
 */
function getSummaryIntroPhrase(detectedLanguage?: string): string {
  if (detectedLanguage === 'pl') {
    return 'Oto kluczowe punkty z Twojej wiadomości głosowej:';
  }
  return 'Here are the key points from your voice message:';
}

/**
 * Strip markdown headers (###) from text.
 * Summaries may include markdown headers like "### Key Points"
 * which don't render well in WhatsApp messages.
 */
function stripMarkdownHeaders(text: string): string {
  return text.replace(/^#{1,6}\s*/gm, '');
}

/**
 * Use case for handling transcription completed events from srt-service.
 */
export class HandleTranscriptionCompletedUseCase {
  constructor(private readonly deps: HandleTranscriptionCompletedDeps) {}

  /**
   * Handle a transcription completed event.
   *
   * @param event - TranscriptionCompletedEvent from srt-service
   * @param logger - Logger for tracking progress
   */
  async execute(event: TranscriptionCompletedEvent, logger: Logger): Promise<void> {
    const { messageRepository, whatsappCloudApi, eventPublisher } = this.deps;

    // Look up message to get phone numbers
    const messageResult = await messageRepository.findById(event.userId, event.messageId);
    if (!messageResult.ok) {
      logger.error(
        { event: 'transcription_completed_message_lookup_error', messageId: event.messageId, userId: event.userId, error: messageResult.error },
        'Failed to look up message for transcription completed event'
      );
      return;
    }

    const message = messageResult.value;
    if (message === null) {
      logger.error(
        { event: 'transcription_completed_message_not_found', messageId: event.messageId, userId: event.userId },
        'Message not found for transcription completed event'
      );
      return;
    }

    const fromNumber = message.fromNumber;
    const phoneNumberId = message.metadata?.phoneNumberId;
    if (phoneNumberId === undefined) {
      logger.error(
        { event: 'transcription_missing_phone_number_id', messageId: event.messageId },
        'Missing phoneNumberId on message metadata, cannot send WhatsApp message'
      );
      return;
    }

    if (event.status === 'completed') {
      // Update Firestore with completed transcription state.
      // Note: if this fails, we continue to send the WhatsApp message so the user is notified.
      // This means command.ingest may be published with the message still in 'pending' Firestore state.
      // The tradeoff prioritizes user-facing delivery over strict state consistency.
      const updateResult = await messageRepository.updateTranscription(event.userId, event.messageId, {
        status: 'completed',
        jobId: event.jobId,
        ...(event.transcript !== undefined && { text: event.transcript }),
        ...(event.summary !== undefined && { summary: event.summary }),
        startedAt: event.timestamp,
        completedAt: new Date().toISOString(),
      });
      if (!updateResult.ok) {
        logger.error(
          { event: 'transcription_update_failed', messageId: event.messageId, error: updateResult.error },
          'Failed to update transcription in Firestore'
        );
      }

      // Build success message
      let whatsappMessage = `🎙️ *Transcription:*\n\n${event.transcript ?? ''}`;
      if (event.summary !== undefined && event.summary !== '') {
        const intro = getSummaryIntroPhrase(event.detectedLanguage);
        const cleanSummary = stripMarkdownHeaders(event.summary);
        whatsappMessage += `\n\n📝 *Summary:*\n\n${intro}\n\n${cleanSummary}`;
      }

      // Send success message via WhatsApp
      const sendResult = await whatsappCloudApi.sendMessage(
        phoneNumberId,
        fromNumber,
        whatsappMessage,
        message.waMessageId
      );
      if (!sendResult.ok) {
        logger.error(
          { event: 'transcription_send_failed', messageId: event.messageId, error: sendResult.error },
          'Failed to send transcription WhatsApp message to user'
        );
        return;
      }

      logger.info(
        { event: 'transcription_completed_message_sent', messageId: event.messageId, userId: event.userId },
        'Sent transcription result to user'
      );

      // Publish command.ingest event
      const commandResult = await eventPublisher.publishCommandIngest({
        type: 'command.ingest',
        userId: event.userId,
        sourceType: 'whatsapp_voice',
        externalId: message.waMessageId,
        text: event.transcript ?? '',
        ...(event.summary !== undefined && { summary: event.summary }),
        timestamp: event.timestamp,
      });
      if (!commandResult.ok) {
        logger.error(
          { event: 'transcription_command_ingest_failed', messageId: event.messageId, error: commandResult.error },
          'Failed to publish command.ingest event'
        );
        return;
      }

      logger.info(
        { event: 'transcription_completed_command_ingest_published', messageId: event.messageId, userId: event.userId },
        'Published command.ingest event'
      );
    } else {
      // Update Firestore with failed transcription state
      const updateFailResult = await messageRepository.updateTranscription(event.userId, event.messageId, {
        status: 'failed',
        jobId: event.jobId,
        error: {
          code: 'TRANSCRIPTION_FAILED',
          message: event.error ?? 'Transcription failed',
        },
        startedAt: event.timestamp,
        completedAt: new Date().toISOString(),
      });
      if (!updateFailResult.ok) {
        logger.error(
          { event: 'transcription_failure_update_failed', messageId: event.messageId, error: updateFailResult.error },
          'Failed to update failed transcription in Firestore'
        );
      }

      // Build failure message
      const errorDetails = event.error ?? 'An error occurred during transcription';
      const failureMessage = `❌ *Transcription failed:*\n\n${errorDetails}`;

      // Send failure message via WhatsApp
      const sendFailResult = await whatsappCloudApi.sendMessage(
        phoneNumberId,
        fromNumber,
        failureMessage,
        message.waMessageId
      );
      if (!sendFailResult.ok) {
        logger.error(
          { event: 'transcription_failure_send_failed', messageId: event.messageId, error: sendFailResult.error },
          'Failed to send transcription failure message to user'
        );
        return;
      }

      logger.info(
        { event: 'transcription_failed_message_sent', messageId: event.messageId, userId: event.userId },
        'Sent transcription failure message to user'
      );
    }
  }
}
