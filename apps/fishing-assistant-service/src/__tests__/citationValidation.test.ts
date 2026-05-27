import { describe, expect, it } from 'vitest';
import { parseFishingAnswer } from '../domain/prompts/parseFishingAnswer.js';
import { validateCitations } from '../domain/prompts/validateCitations.js';

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

const DIGEST_EVIDENCE = [
  {
    id: 'digest:feeder:2026-05-01',
    sourceType: 'digest' as const,
    title: 'May 1 digest',
    text: 'Members reported pinka.',
    quote: 'Members reported pinka.',
    score: 0.8,
    metadata: { groupKey: 'feeder' },
  },
];

describe('Fishing Assistant citation validation', () => {
  it('parses fenced JSON and accepts known citation ids', () => {
    const parsed = parseFishingAnswer(
      '```json\n{"answerMarkdown":"Use light bait.","citations":[{"sourceId":"chunk-1","usedFor":"spring recipe"}],"confidence":"high"}\n```'
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const validated = validateCitations(parsed.value, EVIDENCE);
    expect(validated.ok).toBe(true);
  });

  it('rejects citations that point to an unknown source', () => {
    const validated = validateCitations(
      {
        answerMarkdown: 'Use light bait.',
        citations: [{ sourceId: 'missing', usedFor: 'missing source' }],
        confidence: 'high',
      },
      EVIDENCE
    );

    expect(validated).toEqual({
      ok: false,
      error: {
        code: 'CITATION_VALIDATION_FAILED',
        message: 'Unknown citation sourceId: missing',
      },
    });
  });

  it('allows an explicit insufficient-evidence answer without citations', () => {
    const validated = validateCitations(
      {
        answerMarkdown: 'I do not have enough evidence to answer that confidently.',
        citations: [],
        confidence: 'low',
      },
      EVIDENCE,
      { requireKnowledgeBaseCitation: true }
    );

    expect(validated.ok).toBe(true);
  });

  it('rejects support-only citations when knowledge-base evidence is available', () => {
    const validated = validateCitations(
      {
        answerMarkdown: 'Use pinka.',
        citations: [{ sourceId: 'digest:feeder:2026-05-01', usedFor: 'supporting report' }],
        confidence: 'medium',
      },
      [...EVIDENCE, ...DIGEST_EVIDENCE],
      { requireKnowledgeBaseCitation: true }
    );

    expect(validated).toEqual({
      ok: false,
      error: {
        code: 'CITATION_VALIDATION_FAILED',
        message: 'Fishing Assistant answers must cite at least one knowledge-base source.',
      },
    });
  });

  it('accepts support-only citations when no knowledge-base evidence is available', () => {
    const validated = validateCitations(
      {
        answerMarkdown: 'Use pinka.',
        citations: [{ sourceId: 'digest:feeder:2026-05-01', usedFor: 'supporting report' }],
        confidence: 'medium',
      },
      DIGEST_EVIDENCE,
      { requireKnowledgeBaseCitation: true }
    );

    expect(validated.ok).toBe(true);
  });
});
