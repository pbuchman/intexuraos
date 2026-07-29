export type MessageDigestChatType = 'group' | 'direct';

export type MessageDigestSourceContentKind =
  | 'text'
  | 'media_caption'
  | 'transcription'
  | 'reaction'
  | 'system';

export interface MessageDigestSourceMessage {
  readonly messageRef: string;
  readonly eventTimestamp: string;
  readonly direction: 'inbound' | 'outbound' | 'system';
  readonly authorLabel: string;
  readonly text: string;
  readonly contentKind: MessageDigestSourceContentKind;
}

export interface MessageDigestPreviousSummary {
  readonly runId: string;
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly headline: string;
  readonly summaryMarkdown: string;
  readonly continuityMemoryMarkdown: string;
}

export interface MessageDigestAggregatePromptInput {
  readonly chatType: MessageDigestChatType;
  readonly conversationLabel: string;
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly instructions: string;
  readonly continuityMemoryMarkdown: string;
  readonly previousSummaries: readonly MessageDigestPreviousSummary[];
  readonly sourceMessages: readonly MessageDigestSourceMessage[];
}

export interface MessageDigestSynthesisPromptInput {
  readonly chatType: MessageDigestChatType;
  readonly conversationLabel: string;
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly instructions: string;
  readonly continuityMemoryMarkdown: string;
  readonly chunkAggregates: readonly MessageDigestAggregate[];
}

export interface MessageDigestAggregate {
  readonly headline: string;
  readonly summaryMarkdown: string;
  readonly evidenceMessageRefs: string[];
  readonly continuityMemoryMarkdown: string;
}

export interface MessageDigestRepairPromptInput {
  readonly originalPrompt: string;
  readonly invalidResponse: string;
  readonly errorMessage: string;
  readonly allowedEvidenceMessageRefs: readonly string[];
}
