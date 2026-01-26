/**
 * Tests for buildResearchPrompt.
 */

import { describe, expect, it } from 'vitest';
import { buildResearchPrompt } from '../researchPrompt.js';
import type { ResearchContext } from '../contextTypes.js';

const createTestResearchContext = (overrides?: Partial<ResearchContext>): ResearchContext => ({
  language: 'en',
  domain: 'technical',
  mode: 'standard',
  intent_summary: 'User wants to understand machine learning basics',
  defaults_applied: [],
  assumptions: [],
  answer_style: ['practical'],
  time_scope: {
    as_of_date: '2025-01-01',
    prefers_recent_years: 2,
    is_time_sensitive: false,
  },
  locale_scope: {
    country_or_region: 'United States',
    jurisdiction: 'United States',
    currency: 'USD',
  },
  research_plan: {
    key_questions: ['What is ML?', 'How does it work?'],
    search_queries: ['machine learning basics', 'ML tutorial'],
    preferred_source_types: ['official', 'academic'],
    avoid_source_types: ['random_blogs'],
  },
  output_format: {
    wants_table: false,
    wants_steps: true,
    wants_pros_cons: false,
    wants_budget_numbers: false,
  },
  safety: {
    high_stakes: false,
    required_disclaimers: [],
  },
  red_flags: [],
  ...overrides,
});

describe('buildResearchPrompt', () => {
  describe('without context (default prompt)', () => {
    it('includes the user prompt in the research request section', () => {
      const userPrompt = 'What are the latest developments in quantum computing?';
      const result = buildResearchPrompt(userPrompt);

      expect(result).toContain('## Research Request');
      expect(result).toContain(userPrompt);
    });

    it('includes output structure with flexibility for user structure', () => {
      const result = buildResearchPrompt('test query');

      expect(result).toContain('## Output Structure');
      expect(result).toContain('If the Research Request contains its own structure');
      expect(result).toContain('Overview');
      expect(result).toContain('Main Content');
    });

    it('includes research guidelines with dynamic year', () => {
      const result = buildResearchPrompt('test query');
      const currentYear = new Date().getFullYear();

      expect(result).toContain('## Research Guidelines');
      expect(result).toContain('Cross-reference');
      expect(result).toContain(String(currentYear));
    });

    it('includes inline citation rules with example', () => {
      const result = buildResearchPrompt('test query');

      expect(result).toContain('## Citation Rules (CRITICAL)');
      expect(result).toContain('Inline citations');
      expect(result).toContain('Teide volcano');
    });

    it('includes what NOT to do section', () => {
      const result = buildResearchPrompt('test query');

      expect(result).toContain('## What NOT to Do');
      expect(result).toContain('Do NOT invent or hallucinate sources');
      expect(result).toContain('Do NOT use outdated information');
    });

    it('includes language requirement', () => {
      const result = buildResearchPrompt('test query');

      expect(result).toContain('## Language Requirement');
      expect(result).toContain('SAME LANGUAGE');
    });

    it('includes adaptive behavior section', () => {
      const result = buildResearchPrompt('test query');

      expect(result).toContain('## Adaptive Behavior');
      expect(result).toContain('Travel/lifestyle');
      expect(result).toContain('Technical/programming');
      expect(result).toContain('Medical/health');
    });

    it('returns a non-empty string for empty user prompt', () => {
      const result = buildResearchPrompt('');

      expect(result.length).toBeGreaterThan(0);
      expect(result).toContain('## Research Request');
    });
  });

  describe('with ResearchContext', () => {
    it('includes intent summary from context', () => {
      const ctx = createTestResearchContext();
      const result = buildResearchPrompt('ML query', ctx);

      expect(result).toContain('## Intent Summary');
      expect(result).toContain('User wants to understand machine learning basics');
    });

    it('includes domain guidelines from context', () => {
      const ctx = createTestResearchContext({ domain: 'technical' });
      const result = buildResearchPrompt('ML query', ctx);

      expect(result).toContain('## Domain Guidelines (TECHNICAL)');
      expect(result).toContain('precise definitions');
    });

    it('includes key questions from research plan', () => {
      const ctx = createTestResearchContext();
      const result = buildResearchPrompt('ML query', ctx);

      expect(result).toContain('## Key Questions to Answer');
      expect(result).toContain('What is ML?');
      expect(result).toContain('How does it work?');
    });

    it('includes output format preferences', () => {
      const ctx = createTestResearchContext({
        output_format: {
          wants_table: true,
          wants_steps: true,
          wants_pros_cons: true,
          wants_budget_numbers: false,
        },
      });
      const result = buildResearchPrompt('ML query', ctx);

      expect(result).toContain('## Output Format Preferences');
      expect(result).toContain('Include comparison tables');
      expect(result).toContain('Provide numbered step-by-step');
      expect(result).toContain('Include pros/cons');
    });

    it('includes safety section when high stakes', () => {
      const ctx = createTestResearchContext({
        safety: {
          high_stakes: true,
          required_disclaimers: ['Consult a professional'],
        },
      });
      const result = buildResearchPrompt('query', ctx);

      expect(result).toContain('## Safety Considerations');
      expect(result).toContain('HIGH-STAKES');
      expect(result).toContain('Consult a professional');
    });

    it('includes red flags section when present', () => {
      const ctx = createTestResearchContext({
        red_flags: ['Query may be seeking misinformation'],
      });
      const result = buildResearchPrompt('query', ctx);

      expect(result).toContain('## Research Concerns');
      expect(result).toContain('Query may be seeking misinformation');
    });

    it('includes research guidelines with time scope', () => {
      const ctx = createTestResearchContext();
      const result = buildResearchPrompt('query', ctx);

      expect(result).toContain('## Research Guidelines');
      expect(result).toContain('Time scope');
      expect(result).toContain('2025');
    });

    it('includes language requirement from context', () => {
      const ctx = createTestResearchContext({ language: 'he' });
      const result = buildResearchPrompt('query', ctx);

      expect(result).toContain('## Language Requirement');
      expect(result).toContain('HE');
    });

    it('uses travel domain guidelines', () => {
      const ctx = createTestResearchContext({ domain: 'travel' });
      const result = buildResearchPrompt('query', ctx);

      expect(result).toContain('## Domain Guidelines (TRAVEL)');
      expect(result).toContain('booking links');
    });

    it('uses medical domain guidelines with disclaimers', () => {
      const ctx = createTestResearchContext({ domain: 'medical' });
      const result = buildResearchPrompt('query', ctx);

      expect(result).toContain('## Domain Guidelines (MEDICAL)');
      expect(result).toContain('never provide diagnosis');
    });

    it('uses general domain as fallback for unknown domains', () => {
      const ctx = createTestResearchContext({ domain: 'unknown' });
      const result = buildResearchPrompt('query', ctx);

      expect(result).toContain('balanced, factual information');
    });

    it('includes budget numbers when requested', () => {
      const ctx = createTestResearchContext({
        output_format: {
          wants_table: false,
          wants_steps: false,
          wants_pros_cons: false,
          wants_budget_numbers: true,
        },
      });
      const result = buildResearchPrompt('query', ctx);

      expect(result).toContain('budget figures');
    });

    it('uses default format when no output format preferences set', () => {
      const ctx = createTestResearchContext({
        output_format: {
          wants_table: false,
          wants_steps: false,
          wants_pros_cons: false,
          wants_budget_numbers: false,
        },
      });
      const result = buildResearchPrompt('query', ctx);

      expect(result).toContain('most appropriate format');
    });

    it('skips key questions section when no questions provided', () => {
      const ctx = createTestResearchContext({
        research_plan: {
          key_questions: [],
          search_queries: ['test'],
          preferred_source_types: ['official'],
          avoid_source_types: [],
        },
      });
      const result = buildResearchPrompt('query', ctx);

      expect(result).not.toContain('## Key Questions to Answer');
    });

    it('includes safety disclaimers without high stakes flag', () => {
      const ctx = createTestResearchContext({
        safety: {
          high_stakes: false,
          required_disclaimers: ['Consult a doctor'],
        },
      });
      const result = buildResearchPrompt('query', ctx);

      expect(result).toContain('## Safety Considerations');
      expect(result).toContain('Consult a doctor');
      expect(result).not.toContain('HIGH-STAKES');
    });

    it('includes high stakes without disclaimers', () => {
      const ctx = createTestResearchContext({
        safety: {
          high_stakes: true,
          required_disclaimers: [],
        },
      });
      const result = buildResearchPrompt('query', ctx);

      expect(result).toContain('## Safety Considerations');
      expect(result).toContain('HIGH-STAKES');
      expect(result).not.toContain('Include these disclaimers');
    });

    it('skips safety section when no safety concerns', () => {
      const ctx = createTestResearchContext({
        safety: {
          high_stakes: false,
          required_disclaimers: [],
        },
      });
      const result = buildResearchPrompt('query', ctx);

      expect(result).not.toContain('## Safety Considerations');
    });

    it('skips red flags section when no red flags', () => {
      const ctx = createTestResearchContext({ red_flags: [] });
      const result = buildResearchPrompt('query', ctx);

      expect(result).not.toContain('## Research Concerns');
    });

    it('uses product domain guidelines', () => {
      const ctx = createTestResearchContext({ domain: 'product' });
      const result = buildResearchPrompt('query', ctx);

      expect(result).toContain('Compare features');
    });

    it('uses legal domain guidelines', () => {
      const ctx = createTestResearchContext({ domain: 'legal' });
      const result = buildResearchPrompt('query', ctx);

      expect(result).toContain('professional legal advice');
    });

    it('uses financial domain guidelines', () => {
      const ctx = createTestResearchContext({ domain: 'financial' });
      const result = buildResearchPrompt('query', ctx);

      expect(result).toContain('professional financial advice');
    });

    it('uses general domain guidelines', () => {
      const ctx = createTestResearchContext({ domain: 'general' });
      const result = buildResearchPrompt('query', ctx);

      expect(result).toContain('balanced, factual information');
    });

    it('marks time-sensitive queries', () => {
      const ctx = createTestResearchContext({
        time_scope: {
          as_of_date: '2025-01-01',
          prefers_recent_years: 1,
          is_time_sensitive: true,
        },
      });
      const result = buildResearchPrompt('query', ctx);

      expect(result).toContain('TIME-SENSITIVE');
    });

    it('has both high stakes and disclaimers', () => {
      const ctx = createTestResearchContext({
        safety: {
          high_stakes: true,
          required_disclaimers: ['Consult a professional', 'This is not advice'],
        },
      });
      const result = buildResearchPrompt('query', ctx);

      expect(result).toContain('HIGH-STAKES');
      expect(result).toContain('Consult a professional');
      expect(result).toContain('This is not advice');
    });
  });
});
