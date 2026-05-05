import type { MobileNotificationsServiceClient } from '@intexuraos/internal-clients';
import type { KnowledgeEmbeddingClient } from '../ports/embeddingClient.js';
import type { KnowledgeChunkRepository } from '../ports/knowledgeRepositories.js';
import { extractSearchTerms } from './extractSearchTerms.js';
import {
  rankDigestEvidence,
  rankKnowledgeChunk,
  rankRawMessageEvidence,
} from './rerankEvidence.js';
import type { EvidenceItem, RetrievalError } from './types.js';

export interface RetrieveEvidenceDeps {
  embeddingClient: KnowledgeEmbeddingClient;
  chunkRepository: KnowledgeChunkRepository;
  mobileNotificationsClient: Pick<
    MobileNotificationsServiceClient,
    'listDigestSubscriptions' | 'queryDigests' | 'queryGroupMessages'
  >;
  now: Date;
}

export interface RetrieveEvidenceInput {
  userId: string;
  question: string;
}

function extractDateRange(question: string, now: Date): { dateFrom: string; dateTo: string } {
  const matches = [...question.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)].map((match) => match[0]);
  if (matches.length >= 2 && matches[0] !== undefined && matches[1] !== undefined) {
    return {
      dateFrom: matches[0],
      dateTo: matches[1],
    };
  }
  if (matches.length === 1 && matches[0] !== undefined) {
    return {
      dateFrom: matches[0],
      dateTo: matches[0],
    };
  }

  const dateTo = now.toISOString().slice(0, 10);
  const from = new Date(now.getTime());
  from.setUTCDate(from.getUTCDate() - 90);
  return {
    dateFrom: from.toISOString().slice(0, 10),
    dateTo,
  };
}

export async function retrieveEvidence(
  deps: RetrieveEvidenceDeps,
  input: RetrieveEvidenceInput
): Promise<{ ok: true; value: EvidenceItem[] } | { ok: false; error: RetrievalError }> {
  const terms = extractSearchTerms(input.question);
  const evidence: EvidenceItem[] = [];

  const embeddingResult = await deps.embeddingClient.embedTexts({
    userId: input.userId,
    texts: [input.question],
  });
  if (embeddingResult.ok) {
    const chunkResult = await deps.chunkRepository.findNearestByUserId({
      userId: input.userId,
      embedding: embeddingResult.value[0] ?? [],
      limit: 20,
    });
    if (chunkResult.ok) {
      evidence.push(
        ...chunkResult.value
          .filter((chunk) => chunk.userId === input.userId)
          .map((chunk) => rankKnowledgeChunk(chunk, terms))
          .slice(0, 12)
      );
    }
  }

  const groupsResult = await deps.mobileNotificationsClient.listDigestSubscriptions({
    userId: input.userId,
  });
  const digestEvidence: EvidenceItem[] = [];
  if (groupsResult.ok) {
    const range = extractDateRange(input.question, deps.now);
    for (const group of groupsResult.value.items) {
      const digestResult = await deps.mobileNotificationsClient.queryDigests({
        userId: input.userId,
        groupKey: group.groupKey,
        dateFrom: range.dateFrom,
        dateTo: range.dateTo,
        terms,
        limit: 8,
      });
      if (!digestResult.ok) continue;

      digestEvidence.push(
        ...digestResult.value.items.map((item) => rankDigestEvidence(item, terms)).slice(0, 8)
      );
    }
  }
  evidence.push(...digestEvidence);

  const topDigestDates = digestEvidence
    .sort((left, right) => right.score - left.score)
    .slice(0, 3)
    .map((item) => {
      const groupKey = typeof item.metadata?.['groupKey'] === 'string'
        ? item.metadata['groupKey']
        : '';
      return {
        groupKey,
        date: item.date ?? '',
      };
    })
    .filter((item) => item.groupKey !== '' && item.date !== '');

  for (const item of topDigestDates) {
    const rawResult = await deps.mobileNotificationsClient.queryGroupMessages({
      userId: input.userId,
      groupKey: item.groupKey,
      date: item.date,
      terms,
      limit: 12,
    });
    if (!rawResult.ok) continue;
    evidence.push(
      ...rawResult.value.messages.map((message) => rankRawMessageEvidence(message, terms)).slice(0, 12)
    );
  }

  const ranked = evidence
    .sort((left, right) => right.score - left.score)
    .slice(0, 16);

  if (ranked.length === 0) {
    return {
      ok: false,
      error: {
        code: 'NO_EVIDENCE',
        message: 'No Fishing Assistant evidence matched the request.',
      },
    };
  }

  return { ok: true, value: ranked };
}
