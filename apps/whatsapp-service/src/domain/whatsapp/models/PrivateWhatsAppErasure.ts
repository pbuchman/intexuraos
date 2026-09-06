/**
 * Durable, content-free state for physically erasing one private WhatsApp account generation.
 */

export type PrivateWhatsAppErasureStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed';

export type PrivateWhatsAppErasureStage =
  | 'assistant_sessions'
  | 'assistant_turns'
  | 'assistant_transcript_chunks'
  | 'assistant_context_chunks'
  | 'assistant_context_attachments'
  | 'assistant_turn_requests'
  | 'source_context_changes'
  | 'source_messages'
  | 'source_chats'
  | 'source_senders'
  | 'source_sender_days'
  | 'private_media'
  | 'source_account'
  | 'completed';

export interface PrivateWhatsAppErasureCounts {
  assistantSessions: number;
  assistantTurns: number;
  assistantTranscriptChunks: number;
  assistantContextChunks: number;
  assistantContextAttachments: number;
  assistantTurnRequests: number;
  sourceContextChanges: number;
  sourceMessages: number;
  sourceChats: number;
  sourceSenders: number;
  sourceSenderDays: number;
  privateMediaObjects: number;
  sourceAccounts: number;
}

export interface PrivateWhatsAppErasureRequest {
  erasureRequestId: string;
  userId: string;
  sourceAccountId: string;
  accountGeneration: string;
  status: PrivateWhatsAppErasureStatus;
  stage: PrivateWhatsAppErasureStage;
  counts: PrivateWhatsAppErasureCounts;
  attempt: number;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  failureCode?: 'ACCOUNT_GENERATION_CHANGED' | 'INVALID_STORED_REQUEST';
}

export function emptyPrivateWhatsAppErasureCounts(): PrivateWhatsAppErasureCounts {
  return {
    assistantSessions: 0,
    assistantTurns: 0,
    assistantTranscriptChunks: 0,
    assistantContextChunks: 0,
    assistantContextAttachments: 0,
    assistantTurnRequests: 0,
    sourceContextChanges: 0,
    sourceMessages: 0,
    sourceChats: 0,
    sourceSenders: 0,
    sourceSenderDays: 0,
    privateMediaObjects: 0,
    sourceAccounts: 0,
  };
}

export interface PrivateWhatsAppErasureWorkItem {
  type: 'whatsapp.private-account.erasure';
  sourceAccountId: string;
  userId: string;
  erasureRequestId: string;
  attempt: number;
}
