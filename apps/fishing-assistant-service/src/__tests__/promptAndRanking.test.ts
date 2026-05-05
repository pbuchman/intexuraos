import { describe, expect, it } from 'vitest';
import { Timestamp } from '@intexuraos/infra-firestore';
import { fishingAnswerPrompt } from '../domain/prompts/buildFishingAnswerPrompt.js';
import { parseFishingAnswer } from '../domain/prompts/parseFishingAnswer.js';
import { validateCitations } from '../domain/prompts/validateCitations.js';
import { extractSearchTerms } from '../domain/retrieval/extractSearchTerms.js';
import {
  rankDigestEvidence,
  rankKnowledgeChunk,
  rankRawMessageEvidence,
} from '../domain/retrieval/rerankEvidence.js';

const EVIDENCE = [
  {
    id: 'chunk-1',
    sourceType: 'knowledge_page' as const,
    title: 'Spring Bait',
    text: 'Use light bait in spring.',
    quote: 'Use light bait in spring.',
    score: 0.9,
    metadata: { pageId: 'page-1' },
  },
];

describe('Fishing Assistant prompt and ranking helpers', () => {
  it('builds answer prompts with history and optional evidence dates', () => {
    const prompt = fishingAnswerPrompt.build({
      question: 'What bait now?',
      recentMessages: [
        {
          id: 'message-1',
          chatId: 'chat-1',
          userId: 'user-1',
          role: 'user',
          content: 'Need a spring recipe',
          citations: [],
          createdAt: Timestamp.now(),
        },
      ],
      evidence: [
        {
          id: 'digest:feeder:2026-05-01',
          sourceType: 'digest',
          title: 'May 1 digest',
          date: '2026-05-01',
          text: 'Members reported pinka.',
          quote: 'Members reported pinka.',
          score: 0.8,
          metadata: { groupKey: 'feeder' },
        },
      ],
    });

    expect(prompt).toContain('Conversation history:\nUSER: Need a spring recipe');
    expect(prompt).toContain('[digest:feeder:2026-05-01] (digest) May 1 digest 2026-05-01');
  });

  it('omits empty history and strips stopwords from search terms', () => {
    const prompt = fishingAnswerPrompt.build({
      question: 'What changed today?',
      recentMessages: [],
      evidence: EVIDENCE,
    });

    expect(prompt).not.toContain('Conversation history:');
    expect(extractSearchTerms('Did this change for bait and method?')).toEqual([
      'change',
      'bait',
      'method',
    ]);
    expect(extractSearchTerms('123 !!!')).toEqual([]);
  });

  it('parses invalid JSON and schema failures explicitly', () => {
    expect(parseFishingAnswer('not-json')).toEqual({
      ok: false,
      error: {
        code: 'INVALID_OUTPUT',
        message: 'Fishing Assistant response was not valid JSON.',
      },
    });

    const invalidSchema = parseFishingAnswer('{"answerMarkdown":"x","citations":[],"confidence":"certain"}');
    expect(invalidSchema.ok).toBe(false);
    if (invalidSchema.ok) return;
    expect(invalidSchema.error.code).toBe('INVALID_OUTPUT');
  });

  it('requires citations unless the answer explicitly says evidence is insufficient', () => {
    const missingCitation = validateCitations(
      {
        answerMarkdown: 'Use pinka.',
        citations: [],
        confidence: 'medium',
      },
      EVIDENCE
    );
    const polishInsufficient = validateCitations(
      {
        answerMarkdown: 'Brak wystarczających danych, aby odpowiedzieć pewnie.',
        citations: [],
        confidence: 'low',
      },
      EVIDENCE
    );

    expect(missingCitation).toEqual({
      ok: false,
      error: {
        code: 'CITATION_VALIDATION_FAILED',
        message: 'Fishing Assistant answers must cite at least one source.',
      },
    });
    expect(polishInsufficient.ok).toBe(true);
  });

  it('ranks evidence variants with heading, message count, and sender fallbacks', () => {
    const rankedChunk = rankKnowledgeChunk(
      {
        id: 'chunk-1',
        userId: 'user-1',
        pageId: 'page-1',
        folderId: 'folder-1',
        title: 'Spring Bait',
        heading: null,
        index: 0,
        text: 'Use pinka.',
        searchableText: 'spring bait pinka',
        contentType: 'recipe',
        embeddingModel: 'text-embedding-3-small',
        createdAt: Timestamp.now(),
        vectorScore: 0.8,
      },
      []
    );
    const rankedDigest = rankDigestEvidence(
      {
        groupKey: 'feeder',
        date: '2026-05-01',
        title: 'May 1',
        summaryMarkdown: 'pinka',
        messageCount: 0,
      },
      ['pinka']
    );
    const rankedRaw = rankRawMessageEvidence(
      {
        messageRef: 'msg-1',
        groupKey: 'feeder',
        date: '2026-05-01',
        senderLabel: null,
        text: 'Use pinka',
        quote: 'Use pinka',
      },
      ['pinka']
    );

    expect(rankedChunk).not.toHaveProperty('heading');
    expect(rankedDigest.score).toBe(0.7);
    expect(rankedRaw.title).toBe('Group message');
  });
});
