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

const MOBILE_NOTIFICATIONS_TIMEOUT_MS = 5_000;
const HISTORICAL_DATE_FLOOR = '1970-01-01';
const DIGEST_PAGE_LIMIT = 100;
const RAW_MESSAGE_PAGE_LIMIT = 500;
const FINAL_EVIDENCE_LIMIT = 16;

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
  return {
    dateFrom: HISTORICAL_DATE_FLOOR,
    dateTo,
  };
}

async function collectDigestEvidence(input: {
  client: Pick<MobileNotificationsServiceClient, 'queryDigests'>;
  userId: string;
  groupKey: string;
  dateFrom: string;
  dateTo: string;
  terms: string[];
}): Promise<EvidenceItem[]> {
  const evidence: EvidenceItem[] = [];
  let cursor: string | undefined;
  const seenCursors = new Set<string>();

  do {
    const digestResult = await input.client.queryDigests(
      {
        userId: input.userId,
        groupKey: input.groupKey,
        dateFrom: input.dateFrom,
        dateTo: input.dateTo,
        terms: input.terms,
        limit: DIGEST_PAGE_LIMIT,
        ...(cursor !== undefined ? { cursor } : {}),
      },
      { timeoutMs: MOBILE_NOTIFICATIONS_TIMEOUT_MS }
    );
    if (!digestResult.ok) break;

    const nextCursor = digestResult.value.nextCursor;
    if (nextCursor !== undefined && seenCursors.has(nextCursor)) {
      break;
    }
    evidence.push(
      ...digestResult.value.items.map((item) => rankDigestEvidence(item, input.terms))
    );
    cursor = nextCursor;
    if (cursor !== undefined) seenCursors.add(cursor);
  } while (cursor !== undefined);

  return evidence;
}

async function collectRawMessageEvidence(input: {
  client: Pick<MobileNotificationsServiceClient, 'queryGroupMessages'>;
  userId: string;
  groupKey: string;
  dateFrom: string;
  dateTo: string;
  terms: string[];
}): Promise<EvidenceItem[]> {
  const evidence: EvidenceItem[] = [];
  let cursor: string | undefined;
  const seenCursors = new Set<string>();

  do {
    const rawResult = await input.client.queryGroupMessages(
      {
        userId: input.userId,
        groupKey: input.groupKey,
        dateFrom: input.dateFrom,
        dateTo: input.dateTo,
        terms: input.terms,
        limit: RAW_MESSAGE_PAGE_LIMIT,
        ...(cursor !== undefined ? { cursor } : {}),
      },
      { timeoutMs: MOBILE_NOTIFICATIONS_TIMEOUT_MS }
    );
    if (!rawResult.ok) break;

    const nextCursor = rawResult.value.nextCursor;
    if (nextCursor !== undefined && seenCursors.has(nextCursor)) {
      break;
    }
    evidence.push(
      ...rawResult.value.messages.map((message) => rankRawMessageEvidence(message, input.terms))
    );
    cursor = nextCursor;
    if (cursor !== undefined) seenCursors.add(cursor);
  } while (cursor !== undefined);

  return evidence;
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

  const groupsResult = await deps.mobileNotificationsClient.listDigestSubscriptions(
    {
      userId: input.userId,
    },
    { timeoutMs: MOBILE_NOTIFICATIONS_TIMEOUT_MS }
  );
  const digestEvidence: EvidenceItem[] = [];
  if (groupsResult.ok) {
    const range = extractDateRange(input.question, deps.now);
    for (const group of groupsResult.value.items) {
      const [groupDigestEvidence, rawMessageEvidence] = await Promise.all([
        collectDigestEvidence({
          client: deps.mobileNotificationsClient,
          userId: input.userId,
          groupKey: group.groupKey,
          dateFrom: range.dateFrom,
          dateTo: range.dateTo,
          terms,
        }),
        collectRawMessageEvidence({
          client: deps.mobileNotificationsClient,
          userId: input.userId,
          groupKey: group.groupKey,
          dateFrom: range.dateFrom,
          dateTo: range.dateTo,
          terms,
        }),
      ]);
      digestEvidence.push(...groupDigestEvidence);
      evidence.push(...rawMessageEvidence);
    }
  }
  evidence.push(...digestEvidence);

  const ranked = evidence
    .sort((left, right) => right.score - left.score)
    .slice(0, FINAL_EVIDENCE_LIMIT);

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
