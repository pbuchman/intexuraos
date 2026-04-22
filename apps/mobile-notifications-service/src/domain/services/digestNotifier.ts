import { ok, type Result } from '@intexuraos/common-core';

export interface DigestNotificationError {
  readonly code: 'notification_failed';
  readonly message: string;
}

export interface DigestReadyInput {
  readonly userId: string;
  readonly groupKey: string;
  readonly date: string; // YYYY-MM-DD
  readonly headline: string;
  readonly bullets: readonly string[];
  readonly messageCount: number;
}

export interface DigestNotifier {
  sendDigestReady(input: DigestReadyInput): Promise<Result<void, DigestNotificationError>>;
}

export class NoopDigestNotifier implements DigestNotifier {
  async sendDigestReady(_input: DigestReadyInput): Promise<Result<void, DigestNotificationError>> {
    return await Promise.resolve(ok(undefined));
  }
}
