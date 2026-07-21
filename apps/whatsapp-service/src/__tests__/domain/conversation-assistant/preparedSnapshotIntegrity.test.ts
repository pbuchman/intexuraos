import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  calculateConversationAssistantPreparedSnapshotIntegrity,
  verifyConversationAssistantPreparedSnapshotIntegrity,
} from '../../../domain/conversation-assistant/preparedSnapshotIntegrity.js';
import type { ConversationAssistantContextAttachmentPreparedSnapshot } from '../../../domain/conversation-assistant/types.js';

const TRANSCRIPT_TEXT = '[2026-07-21T08:00:00.000Z] Them: hello';
const PREVIOUS_CONTEXT_CHAIN_SHA256 = 'a'.repeat(64);

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function snapshot(): ConversationAssistantContextAttachmentPreparedSnapshot {
  const integrity = calculateConversationAssistantPreparedSnapshotIntegrity({
    transcriptText: TRANSCRIPT_TEXT,
    messages: [],
    omittedMessages: [],
    corrections: [],
    previousContextChainSha256: PREVIOUS_CONTEXT_CHAIN_SHA256,
  });
  return {
    transcriptText: TRANSCRIPT_TEXT,
    messages: [],
    omittedMessages: [],
    corrections: [],
    counts: {
      included: 0,
      omitted: 0,
      newlyAvailable: 0,
      edited: 0,
      redacted: 0,
      deleted: 0,
      reactionsChanged: 0,
      lateIngested: 0,
      completedTranscriptions: 0,
    },
    omitted: {
      mediaOnly: 0,
      failedTranscriptions: 0,
      pendingTranscriptions: 0,
      nonText: 0,
      overLimit: 0,
    },
    deltaTranscriptSha256: integrity.deltaTranscriptSha256,
    previousContextChainSha256: PREVIOUS_CONTEXT_CHAIN_SHA256,
    resultingContextChainSha256: integrity.resultingContextChainSha256,
    estimatedInputTokens: 0,
    requiresConfirmation: false,
  };
}

describe('Conversation Assistant prepared snapshot integrity', () => {
  it('uses the versioned canonical field set and order shared with the delta builder', () => {
    const canonicalSnapshotSha256 = sha256(
      JSON.stringify({
        version: 1,
        messages: [],
        omittedMessages: [],
        corrections: [],
      })
    );
    const deltaTranscriptSha256 = sha256(TRANSCRIPT_TEXT);

    expect(
      calculateConversationAssistantPreparedSnapshotIntegrity({
        transcriptText: TRANSCRIPT_TEXT,
        messages: [],
        omittedMessages: [],
        corrections: [],
        previousContextChainSha256: PREVIOUS_CONTEXT_CHAIN_SHA256,
      })
    ).toEqual({
      deltaTranscriptSha256,
      canonicalSnapshotSha256,
      canonicalSnapshotUtf8ByteLength: Buffer.byteLength(
        JSON.stringify({
          version: 1,
          messages: [],
          omittedMessages: [],
          corrections: [],
        }),
        'utf8'
      ),
      resultingContextChainSha256: sha256(
        JSON.stringify({
          version: 1,
          previousContextChainSha256: PREVIOUS_CONTEXT_CHAIN_SHA256,
          deltaTranscriptSha256,
          snapshotSha256: canonicalSnapshotSha256,
        })
      ),
    });
  });

  it('accepts only a snapshot whose transcript and canonical structured content match its hashes', () => {
    const valid = snapshot();
    expect(verifyConversationAssistantPreparedSnapshotIntegrity(valid)).toBe(true);

    expect(
      verifyConversationAssistantPreparedSnapshotIntegrity({
        ...valid,
        transcriptText: `${valid.transcriptText} tampered`,
      })
    ).toBe(false);
    expect(
      verifyConversationAssistantPreparedSnapshotIntegrity({
        ...valid,
        messages: [{ id: 'tampered-message' }] as never,
      })
    ).toBe(false);
    expect(
      verifyConversationAssistantPreparedSnapshotIntegrity({
        ...valid,
        omittedMessages: [{ id: 'tampered-omission' }] as never,
      })
    ).toBe(false);
    expect(
      verifyConversationAssistantPreparedSnapshotIntegrity({
        ...valid,
        corrections: [{ messageId: 'tampered-correction' }] as never,
      })
    ).toBe(false);
  });
});
