import type {
  PrivateConversationContextOmissionReason,
  PrivateWhatsAppMessageDirection,
  PrivateWhatsAppMessageType,
  PrivateWhatsAppReactionSummary,
} from './PrivateWhatsApp.js';

export type PrivateWhatsAppContextChangeType =
  | 'created'
  | 'transcription_changed'
  | 'edited'
  | 'redacted'
  | 'deleted'
  | 'reaction_changed';

export type PrivateWhatsAppContextProjection =
  | { state: 'missing' }
  | {
      state: 'included';
      eventTimestamp: string;
      importedAt: string;
      direction: PrivateWhatsAppMessageDirection;
      speakerLabel: string;
      messageType: PrivateWhatsAppMessageType;
      contentKind: 'text' | 'transcription';
      content: string;
      reactions: PrivateWhatsAppReactionSummary[];
    }
  | {
      state: 'omitted';
      eventTimestamp: string;
      importedAt: string;
      direction: PrivateWhatsAppMessageDirection;
      speakerLabel: string;
      messageType: PrivateWhatsAppMessageType;
      omissionReason: PrivateConversationContextOmissionReason;
      reactions: PrivateWhatsAppReactionSummary[];
    }
  | {
      state: 'redacted' | 'deleted';
      eventTimestamp: string;
      importedAt: string;
      direction: PrivateWhatsAppMessageDirection;
      speakerLabel: string;
      messageType: PrivateWhatsAppMessageType;
    };

export interface PrivateWhatsAppContextChange {
  userId: string;
  sourceAccountId: string;
  chatId: string;
  sequence: number;
  messageId: string;
  messageRevision: number;
  changeType: PrivateWhatsAppContextChangeType;
  changedAt: string;
  eventTimestamp: string;
  before: PrivateWhatsAppContextProjection;
  after: PrivateWhatsAppContextProjection;
  schemaVersion: 1;
}

export interface PrivateWhatsAppOwnedChatInput {
  userId: string;
  sourceAccountId: string;
  chatId: string;
}

export interface PrivateWhatsAppContextJournalQueryInput extends PrivateWhatsAppOwnedChatInput {
  afterSequence: number;
  throughSequence: number;
  limit: number;
}

export interface PrivateWhatsAppContextJournalQueryResult {
  entries: PrivateWhatsAppContextChange[];
  nextAfterSequence?: number;
}

export interface PrivateWhatsAppContextMessagesByIdsInput extends PrivateWhatsAppOwnedChatInput {
  messageIds: string[];
}
