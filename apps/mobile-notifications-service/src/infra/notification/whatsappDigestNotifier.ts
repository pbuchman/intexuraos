import { err, ok, type Logger, type Result } from '@intexuraos/common-core';
import type { WhatsAppSendPublisher } from '@intexuraos/infra-pubsub';
import type {
  DigestNotificationError,
  DigestNotifier,
  DigestReadyInput,
} from '../../domain/services/digestNotifier.js';
import { formatDigestMessage } from './formatDigestMessage.js';

export interface WhatsAppDigestNotifierConfig {
  readonly publisher: WhatsAppSendPublisher;
  readonly webAppUrl: string;
  readonly logger: Logger;
}

function stripTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

function buildDigestUrl(webAppUrl: string, groupKey: string, date: string): string {
  const base = stripTrailingSlash(webAppUrl);
  return `${base}/#/notifications/digests/${encodeURIComponent(groupKey)}/${encodeURIComponent(date)}`;
}

export class WhatsAppDigestNotifier implements DigestNotifier {
  private readonly publisher: WhatsAppSendPublisher;
  private readonly webAppUrl: string;
  private readonly logger: Logger;

  constructor(config: WhatsAppDigestNotifierConfig) {
    this.publisher = config.publisher;
    this.webAppUrl = config.webAppUrl;
    this.logger = config.logger;
  }

  async sendDigestReady(input: DigestReadyInput): Promise<Result<void, DigestNotificationError>> {
    const message = formatDigestMessage({
      headline: input.headline,
      bullets: input.bullets,
      messageCount: input.messageCount,
    });
    const ctaUrl = { displayText: 'View Full Digest', url: buildDigestUrl(this.webAppUrl, input.groupKey, input.date) };
    const correlationId = `digest-ready-${input.userId}-${input.groupKey}-${input.date}`;

    const published = await this.publisher.publishSendMessage({
      userId: input.userId,
      message,
      ctaUrl,
      correlationId,
    });

    if (!published.ok) {
      this.logger.error(
        { userId: input.userId, groupKey: input.groupKey, date: input.date, error: published.error },
        'WhatsAppDigestNotifier: publish failed'
      );
      return err({ code: 'notification_failed', message: published.error.message });
    }

    this.logger.info(
      { userId: input.userId, groupKey: input.groupKey, date: input.date, correlationId },
      'WhatsAppDigestNotifier: digest-ready message published'
    );
    return ok(undefined);
  }
}
