/**
 * Tests for parseExtractionResponse domain function.
 * Validates JSON parsing, markdown unwrapping, Zod validation,
 * and ExtractedIssueData mapping without any LLM dependency.
 */
import { describe, expect, it } from 'vitest';
import { parseExtractionResponse } from '../../domain/extractionParser.js';

const VALID_JSON = {
  title: 'Fix login bug',
  priority: 2,
  functionalRequirements: 'User should be able to login',
  technicalDetails: 'Check auth service',
  valid: true,
  error: null,
  reasoning: 'Issue extracted successfully',
};

describe('parseExtractionResponse', () => {
  describe('valid JSON', () => {
    it('parses valid JSON response into ExtractedIssueData', () => {
      const result = parseExtractionResponse(JSON.stringify(VALID_JSON));

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.title).toBe('Fix login bug');
        expect(result.value.priority).toBe(2);
        expect(result.value.functionalRequirements).toBe('User should be able to login');
        expect(result.value.technicalDetails).toBe('Check auth service');
        expect(result.value.valid).toBe(true);
        expect(result.value.error).toBeNull();
        expect(result.value.reasoning).toBe('Issue extracted successfully');
      }
    });

    it('handles JSON with leading/trailing whitespace', () => {
      const result = parseExtractionResponse(`   ${JSON.stringify(VALID_JSON)}   `);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.title).toBe('Fix login bug');
      }
    });
  });

  describe('markdown-wrapped JSON', () => {
    it('extracts JSON from markdown code block with json identifier', () => {
      const markdown = `\`\`\`json\n${JSON.stringify(VALID_JSON)}\n\`\`\``;
      const result = parseExtractionResponse(markdown);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.title).toBe('Fix login bug');
        expect(result.value.priority).toBe(2);
      }
    });

    it('extracts JSON from markdown code block without language identifier', () => {
      const markdown = `\`\`\`\n${JSON.stringify(VALID_JSON)}\n\`\`\``;
      const result = parseExtractionResponse(markdown);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.title).toBe('Fix login bug');
      }
    });
  });

  describe('invalid JSON', () => {
    it('returns EXTRACTION_FAILED for malformed JSON', () => {
      const result = parseExtractionResponse('{ this is not valid json }');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('EXTRACTION_FAILED');
        expect(result.error.message).toContain('Failed to parse');
      }
    });

    it('returns EXTRACTION_FAILED for empty string', () => {
      const result = parseExtractionResponse('');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('EXTRACTION_FAILED');
      }
    });

    it('returns EXTRACTION_FAILED for non-JSON text', () => {
      const result = parseExtractionResponse('This is just plain text, not JSON at all');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('EXTRACTION_FAILED');
      }
    });

    it('returns EXTRACTION_FAILED for partial markdown code block', () => {
      const partial = `\`\`\`json\n${JSON.stringify(VALID_JSON)}`;
      const result = parseExtractionResponse(partial);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('EXTRACTION_FAILED');
        expect(result.error.message).toContain('Failed to parse');
      }
    });
  });

  describe('schema-invalid JSON', () => {
    it('returns EXTRACTION_FAILED when JSON is missing required fields', () => {
      const missingTitle = {
        priority: 2,
        valid: true,
        reasoning: 'Some reasoning',
      };
      const result = parseExtractionResponse(JSON.stringify(missingTitle));

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('EXTRACTION_FAILED');
        expect(result.error.message).toContain('invalid response format');
      }
    });

    it('returns EXTRACTION_FAILED when priority is out of range', () => {
      const invalidPriority = {
        title: 'Test',
        priority: 999,
        valid: true,
        reasoning: 'Test',
      };
      const result = parseExtractionResponse(JSON.stringify(invalidPriority));

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('EXTRACTION_FAILED');
      }
    });

    it('returns EXTRACTION_FAILED when priority has wrong type', () => {
      const wrongType = {
        title: 'Test',
        priority: 'high',
        valid: true,
        reasoning: 'Test',
      };
      const result = parseExtractionResponse(JSON.stringify(wrongType));

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('EXTRACTION_FAILED');
      }
    });
  });

  describe('valid=false response', () => {
    it('returns ok with valid=false and error message', () => {
      const invalidExtraction = {
        title: 'Unclear request',
        priority: 0,
        functionalRequirements: null,
        technicalDetails: null,
        valid: false,
        error: 'User intent unclear - need more details',
        reasoning: 'Input lacks sufficient information',
      };
      const result = parseExtractionResponse(JSON.stringify(invalidExtraction));

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.valid).toBe(false);
        expect(result.value.error).toBe('User intent unclear - need more details');
        expect(result.value.reasoning).toBe('Input lacks sufficient information');
      }
    });
  });
});
