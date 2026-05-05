import type { KnowledgeChunkMatch } from '../models/knowledge.js';
import type { EvidenceItem } from './types.js';

function lexicalScore(text: string, terms: string[]): number {
  if (terms.length === 0) return 0;
  const haystack = text.toLowerCase();
  const matched = terms.filter((term) => haystack.includes(term)).length;
  return matched / terms.length;
}

export function rankKnowledgeChunk(
  chunk: KnowledgeChunkMatch,
  terms: string[]
): EvidenceItem {
  const score = 0.75 * chunk.vectorScore + 0.25 * lexicalScore(chunk.searchableText, terms);
  return {
    id: chunk.id,
    sourceType: 'knowledge_page',
    title: chunk.title,
    text: chunk.text,
    quote: chunk.text,
    url: `/fishing-assistant/knowledge/pages/${chunk.pageId}`,
    score,
    ...(chunk.heading !== null ? { heading: chunk.heading } : {}),
    metadata: { pageId: chunk.pageId, chunkId: chunk.id },
  };
}

export function rankDigestEvidence(
  input: {
    groupKey: string;
    date: string;
    title: string;
    summaryMarkdown: string;
    messageCount: number;
  },
  terms: string[]
): EvidenceItem {
  const score = 0.7 * lexicalScore(`${input.title}\n${input.summaryMarkdown}`, terms) +
    (input.messageCount > 0 ? 0.3 : 0);
  return {
    id: `digest:${input.groupKey}:${input.date}`,
    sourceType: 'digest',
    title: input.title,
    date: input.date,
    text: input.summaryMarkdown,
    quote: input.summaryMarkdown,
    url: `/fishing-assistant/digests/${input.groupKey}/${input.date}`,
    score,
    metadata: { groupKey: input.groupKey, date: input.date },
  };
}

export function rankRawMessageEvidence(
  input: {
    messageRef: string;
    groupKey: string;
    date: string;
    senderLabel?: string | null;
    text: string;
    quote: string;
  },
  terms: string[]
): EvidenceItem {
  const score = lexicalScore(input.text, terms);
  return {
    id: input.messageRef,
    sourceType: 'raw_message',
    title: input.senderLabel ?? 'Group message',
    date: input.date,
    text: input.text,
    quote: input.quote,
    score,
    metadata: { groupKey: input.groupKey, messageRef: input.messageRef },
  };
}
