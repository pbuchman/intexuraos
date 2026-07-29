import type {
  LegacyDigestDefinitionProjection,
  LegacyDigestRunProjection,
  MessageDigestServiceClient,
  PrivateDigestMessage,
  WhatsAppServiceClient,
} from '@intexuraos/internal-clients';
import type { KnowledgeEmbeddingClient } from '../ports/embeddingClient.js';
import type { KnowledgeChunkRepository } from '../ports/knowledgeRepositories.js';
import { extractSearchTerms } from './extractSearchTerms.js';
import {
  FISHING_DIGEST_TIME_ZONE,
  FISHING_LEGACY_GROUP_KEY,
  isValidFishingLocalDate,
} from './fishingDigestSource.js';
import {
  rankDigestEvidence,
  rankKnowledgeChunk,
  rankRawMessageEvidence,
} from './rerankEvidence.js';
import type { EvidenceItem, RetrievalError } from './types.js';

export interface RetrieveEvidenceDeps {
  embeddingClient: KnowledgeEmbeddingClient;
  chunkRepository: KnowledgeChunkRepository;
  messageDigestClient: Pick<
    MessageDigestServiceClient,
    'queryLegacyDigestDefinitions' | 'queryLegacyDigestRuns'
  >;
  whatsappClient: Pick<WhatsAppServiceClient, 'queryPrivateDigestMessages'>;
  now: Date;
}

export interface RetrieveEvidenceInput {
  userId: string;
  question: string;
}

const DOWNSTREAM_TIMEOUT_MS = 5_000;
const DIGEST_PAGE_LIMIT = 100;
const RAW_MESSAGE_PAGE_LIMIT = 200;
const DEFAULT_LOOKBACK_DAYS = 90;
const MAX_DIGEST_PAGES = 2;
const MAX_RAW_SOURCE_RUNS = 4;
const MAX_RAW_PAGES_PER_RUN = 2;
const MAX_DIGEST_TERMS = 20;
const MAX_DIGEST_TERM_LENGTH = 100;
const FINAL_EVIDENCE_LIMIT = 16;
const KNOWLEDGE_EVIDENCE_LIMIT = 12;

interface DigestDateRange {
  fromDate: string;
  toDate: string;
}

function extractDateRange(question: string, now: Date): DigestDateRange {
  const matches = [...question.matchAll(/\b\d{4}-\d{2}-\d{2}\b/gu)]
    .map((match) => match[0])
    .filter(isValidFishingLocalDate);
  if (matches.length >= 2 && matches[0] !== undefined && matches[1] !== undefined) {
    return { fromDate: matches[0], toDate: matches[1] };
  }
  if (matches.length === 1 && matches[0] !== undefined) {
    return { fromDate: matches[0], toDate: matches[0] };
  }
  const toDate = localDate(now);
  return { fromDate: shiftCalendarDate(toDate, -(DEFAULT_LOOKBACK_DAYS - 1)), toDate };
}

function shiftCalendarDate(value: string, days: number): string {
  const timestamp = Date.parse(`${value}T00:00:00.000Z`) + days * 24 * 60 * 60 * 1_000;
  return new Date(timestamp).toISOString().slice(0, 10);
}

function boundedDigestTerms(question: string): string[] {
  return extractSearchTerms(question)
    .filter((term) => term.length <= MAX_DIGEST_TERM_LENGTH)
    .slice(0, MAX_DIGEST_TERMS);
}

async function collectKnowledgeEvidence(input: {
  deps: Pick<RetrieveEvidenceDeps, 'embeddingClient' | 'chunkRepository'>;
  userId: string;
  question: string;
  terms: string[];
}): Promise<EvidenceItem[]> {
  const embeddingResult = await input.deps.embeddingClient.embedTexts({
    userId: input.userId,
    texts: [input.question],
  });
  if (!embeddingResult.ok) return [];
  const chunkResult = await input.deps.chunkRepository.findNearestByUserId({
    userId: input.userId,
    embedding: embeddingResult.value[0] ?? [],
    limit: 20,
  });
  if (!chunkResult.ok) return [];
  return chunkResult.value
    .filter((chunk) => chunk.userId === input.userId)
    .map((chunk) => rankKnowledgeChunk(chunk, input.terms));
}

function isExactFishingDefinition(
  definition: LegacyDigestDefinitionProjection,
  userAlias: string
): boolean {
  const runtimeSource = definition.source as unknown as Record<string, unknown>;
  return (
    definition.legacyGroupKey === userAlias &&
    runtimeSource['chatType'] === 'group'
  );
}

async function readFishingDefinition(input: {
  client: RetrieveEvidenceDeps['messageDigestClient'];
  userId: string;
}): Promise<LegacyDigestDefinitionProjection | null> {
  const result = await input.client.queryLegacyDigestDefinitions(
    {
      userId: input.userId,
      legacyGroupKey: FISHING_LEGACY_GROUP_KEY,
    },
    { timeoutMs: DOWNSTREAM_TIMEOUT_MS }
  );
  if (!result.ok) return null;
  return (
    result.value.items.find((definition) =>
      isExactFishingDefinition(definition, FISHING_LEGACY_GROUP_KEY)
    ) ?? null
  );
}

async function collectDigestRuns(input: {
  client: RetrieveEvidenceDeps['messageDigestClient'];
  userId: string;
  definitionId: string;
  range: DigestDateRange;
  terms: string[];
}): Promise<LegacyDigestRunProjection[]> {
  const runs: LegacyDigestRunProjection[] = [];
  const seenRunIds = new Set<string>();
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  let pagesRead = 0;

  for (;;) {
    const result = await input.client.queryLegacyDigestRuns(
      {
        userId: input.userId,
        legacyGroupKey: FISHING_LEGACY_GROUP_KEY,
        fromDate: input.range.fromDate,
        toDate: input.range.toDate,
        ...(input.terms.length === 0 ? {} : { terms: input.terms }),
        limit: DIGEST_PAGE_LIMIT,
        ...(cursor === undefined ? {} : { cursor }),
      },
      { timeoutMs: DOWNSTREAM_TIMEOUT_MS }
    );
    if (!result.ok) break;
    pagesRead += 1;
    for (const run of result.value.items) {
      if (
        run.definitionId !== input.definitionId ||
        run.legacyGroupKey !== FISHING_LEGACY_GROUP_KEY ||
        seenRunIds.has(run.runId)
      ) {
        continue;
      }
      seenRunIds.add(run.runId);
      runs.push(run);
    }
    const nextCursor = result.value.nextCursor;
    if (
      nextCursor === null ||
      seenCursors.has(nextCursor) ||
      pagesRead >= MAX_DIGEST_PAGES
    ) {
      break;
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }
  return runs;
}

function messageFallsInsideRun(message: PrivateDigestMessage, run: LegacyDigestRunProjection): boolean {
  const timestamp = Date.parse(message.eventTimestamp);
  return (
    Number.isFinite(timestamp) &&
    timestamp >= Date.parse(run.windowStart) &&
    timestamp < Date.parse(run.windowEnd)
  );
}

async function collectRawMessageEvidence(input: {
  client: RetrieveEvidenceDeps['whatsappClient'];
  userId: string;
  definition: LegacyDigestDefinitionProjection;
  run: LegacyDigestRunProjection;
  terms: string[];
  seenMessageRefs: Set<string>;
}): Promise<EvidenceItem[]> {
  const allowedRefs = new Set(input.run.evidenceMessageRefs);
  if (allowedRefs.size === 0) return [];
  const foundRefs = new Set<string>();
  const evidence: EvidenceItem[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  let pagesRead = 0;

  for (;;) {
    const result = await input.client.queryPrivateDigestMessages({
      userId: input.userId,
      sourceAccountId: input.definition.source.sourceAccountId,
      generationId: input.definition.source.generationId,
      chatId: input.definition.source.chatId,
      chatType: 'group',
      windowStart: input.run.windowStart,
      windowEnd: input.run.windowEnd,
      limit: RAW_MESSAGE_PAGE_LIMIT,
      ...(cursor === undefined ? {} : { cursor }),
    });
    if (!result.ok) break;
    pagesRead += 1;
    for (const message of result.value.messages) {
      if (
        !allowedRefs.has(message.messageRef) ||
        input.seenMessageRefs.has(message.messageRef) ||
        !messageFallsInsideRun(message, input.run)
      ) {
        continue;
      }
      foundRefs.add(message.messageRef);
      input.seenMessageRefs.add(message.messageRef);
      evidence.push(
        rankRawMessageEvidence(
          {
            messageRef: message.messageRef,
            groupKey: FISHING_LEGACY_GROUP_KEY,
            date: localDate(new Date(message.eventTimestamp)),
            senderLabel: message.authorLabel,
            text: message.text,
            quote: message.text,
          },
          input.terms
        )
      );
    }
    if (foundRefs.size === allowedRefs.size) break;
    const nextCursor = result.value.nextCursor;
    if (
      nextCursor === null ||
      seenCursors.has(nextCursor) ||
      pagesRead >= MAX_RAW_PAGES_PER_RUN
    ) {
      break;
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }
  return evidence;
}

function localDate(value: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: FISHING_DIGEST_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error('INVALID_FISHING_LOCAL_DATE');
  }
  return `${year}-${month}-${day}`;
}

export async function retrieveEvidence(
  deps: RetrieveEvidenceDeps,
  input: RetrieveEvidenceInput
): Promise<{ ok: true; value: EvidenceItem[] } | { ok: false; error: RetrievalError }> {
  const terms = boundedDigestTerms(input.question);
  const knowledgeEvidence = await collectKnowledgeEvidence({
    deps,
    userId: input.userId,
    question: input.question,
    terms,
  });
  const supportingEvidence: EvidenceItem[] = [];
  const definition = await readFishingDefinition({
    client: deps.messageDigestClient,
    userId: input.userId,
  });

  if (definition !== null) {
    const runs = await collectDigestRuns({
      client: deps.messageDigestClient,
      userId: input.userId,
      definitionId: definition.definitionId,
      range: extractDateRange(input.question, deps.now),
      terms,
    });
    const rankedRuns = runs.map((run) => ({
      run,
      evidence: rankDigestEvidence(
          {
            groupKey: run.legacyGroupKey,
            date: run.date,
            title: run.title,
            summaryMarkdown: run.summaryMarkdown,
            messageCount: run.messageCount,
          },
          terms
        ),
    }));
    supportingEvidence.push(...rankedRuns.map((item) => item.evidence));
    const seenMessageRefs = new Set<string>();
    const rawRuns = [...rankedRuns]
      .sort((left, right) => right.evidence.score - left.evidence.score)
      .slice(0, MAX_RAW_SOURCE_RUNS);
    const rawEvidencePages = await Promise.all(
      rawRuns.map(async ({ run }) =>
        await collectRawMessageEvidence({
          client: deps.whatsappClient,
          userId: input.userId,
          definition,
          run,
          terms,
          seenMessageRefs,
        })
      )
    );
    for (const rawEvidence of rawEvidencePages) {
      supportingEvidence.push(...rawEvidence);
    }
  }

  const rankedKnowledge = knowledgeEvidence
    .sort((left, right) => right.score - left.score)
    .slice(0, KNOWLEDGE_EVIDENCE_LIMIT);
  const supportingSlots = Math.max(0, FINAL_EVIDENCE_LIMIT - rankedKnowledge.length);
  const rankedSupporting = supportingEvidence
    .sort((left, right) => right.score - left.score)
    .slice(0, supportingSlots);
  const ranked = [...rankedKnowledge, ...rankedSupporting];

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
