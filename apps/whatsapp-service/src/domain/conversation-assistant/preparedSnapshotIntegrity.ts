import { createHash } from 'node:crypto';
import type { ConversationAssistantContextAttachmentPreparedSnapshot } from './types.js';

type ConversationAssistantPreparedSnapshotIntegrityInput = Pick<
  ConversationAssistantContextAttachmentPreparedSnapshot,
  | 'transcriptText'
  | 'messages'
  | 'omittedMessages'
  | 'corrections'
  | 'previousContextChainSha256'
>;

export interface ConversationAssistantPreparedSnapshotIntegrity {
  deltaTranscriptSha256: string;
  canonicalSnapshotSha256: string;
  canonicalSnapshotUtf8ByteLength: number;
  resultingContextChainSha256: string;
}

export function calculateConversationAssistantPreparedSnapshotIntegrity(
  input: ConversationAssistantPreparedSnapshotIntegrityInput
): ConversationAssistantPreparedSnapshotIntegrity {
  const deltaTranscriptSha256 = sha256(input.transcriptText);
  const canonicalSnapshot = JSON.stringify({
    version: 1,
    messages: input.messages,
    omittedMessages: input.omittedMessages,
    corrections: input.corrections,
  });
  const canonicalSnapshotSha256 = sha256(canonicalSnapshot);
  return {
    deltaTranscriptSha256,
    canonicalSnapshotSha256,
    canonicalSnapshotUtf8ByteLength: Buffer.byteLength(canonicalSnapshot, 'utf8'),
    resultingContextChainSha256: sha256(
      JSON.stringify({
        version: 1,
        previousContextChainSha256: input.previousContextChainSha256,
        deltaTranscriptSha256,
        snapshotSha256: canonicalSnapshotSha256,
      })
    ),
  };
}

export function verifyConversationAssistantPreparedSnapshotIntegrity(
  snapshot: ConversationAssistantContextAttachmentPreparedSnapshot
): boolean {
  const calculated = calculateConversationAssistantPreparedSnapshotIntegrity(snapshot);
  return (
    snapshot.deltaTranscriptSha256 === calculated.deltaTranscriptSha256 &&
    snapshot.resultingContextChainSha256 === calculated.resultingContextChainSha256
  );
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
