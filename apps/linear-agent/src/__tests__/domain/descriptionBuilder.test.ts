/**
 * Tests for descriptionBuilder.ts - buildIssueDescription function.
 */
import { describe, expect, it } from 'vitest';
import type { ExtractedIssueData } from '../../domain/models.js';
import { buildIssueDescription } from '../../domain/descriptionBuilder.js';

describe('buildIssueDescription', () => {
  const baseExtracted: ExtractedIssueData = {
    title: 'Test Issue',
    priority: 2,
    functionalRequirements: 'Functional req text',
    technicalDetails: 'Technical details text',
    valid: true,
    error: null,
    reasoning: 'Valid',
  };

  describe('with all sections present', () => {
    it('includes all sections in correct order', () => {
      const result = buildIssueDescription(
        baseExtracted,
        'Original user text',
        '- Key point A'
      );

      expect(result).toContain('## Original User Instruction');
      expect(result).toContain('> Original user text');
      expect(result).toContain('## Key Points');
      expect(result).toContain('- Key point A');
      expect(result).toContain('## Functional Requirements');
      expect(result).toContain('Functional req text');
      expect(result).toContain('## Technical Details');
      expect(result).toContain('Technical details text');
    });

    it('sections are joined with double newlines', () => {
      const result = buildIssueDescription(
        baseExtracted,
        'Some text'
      );

      expect(result).toContain('\n\n## Functional Requirements');
      expect(result).toContain('\n\n## Technical Details');
    });
  });

  describe('without functional/technical sections', () => {
    it('only includes Original User Instruction when both are null', () => {
      const extracted: ExtractedIssueData = {
        ...baseExtracted,
        functionalRequirements: null,
        technicalDetails: null,
      };

      const result = buildIssueDescription(extracted, 'Simple text');

      expect(result).toContain('## Original User Instruction');
      expect(result).toContain('> Simple text');
      expect(result).not.toContain('## Functional Requirements');
      expect(result).not.toContain('## Technical Details');
    });

    it('includes Key Points without functional/technical', () => {
      const extracted: ExtractedIssueData = {
        ...baseExtracted,
        functionalRequirements: null,
        technicalDetails: null,
      };

      const result = buildIssueDescription(
        extracted,
        'Text with summary',
        '- Key point A'
      );

      expect(result).toContain('## Original User Instruction');
      expect(result).toContain('## Key Points');
      expect(result).toContain('- Key point A');
      expect(result).not.toContain('## Functional Requirements');
      expect(result).not.toContain('## Technical Details');
    });
  });

  describe('summary variations', () => {
    it('includes Key Points when summary is provided', () => {
      const result = buildIssueDescription(
        baseExtracted,
        'User text',
        '- Point 1\n- Point 2'
      );

      expect(result).toContain('## Key Points');
      expect(result).toContain('- Point 1\n- Point 2');
    });

    it('does not include Key Points section when summary is undefined', () => {
      const result = buildIssueDescription(baseExtracted, 'User text');

      expect(result).not.toContain('## Key Points');
    });
  });

  describe('section ordering', () => {
    it('Original User Instruction comes first', () => {
      const result = buildIssueDescription(
        baseExtracted,
        'First section'
      );

      expect(result.indexOf('## Original User Instruction')).toBe(0);
    });

    it('Key Points comes after Original but before Functional Requirements', () => {
      const result = buildIssueDescription(
        baseExtracted,
        'Original text',
        '- Summary points'
      );

      const originalIndex = result.indexOf('## Original User Instruction');
      const keyPointsIndex = result.indexOf('## Key Points');
      const functionalIndex = result.indexOf('## Functional Requirements');

      expect(originalIndex).toBeLessThan(keyPointsIndex);
      expect(keyPointsIndex).toBeLessThan(functionalIndex);
    });

    it('Functional Requirements comes before Technical Details', () => {
      const result = buildIssueDescription(baseExtracted, 'Original text');

      const functionalIndex = result.indexOf('## Functional Requirements');
      const technicalIndex = result.indexOf('## Technical Details');

      expect(functionalIndex).toBeLessThan(technicalIndex);
    });
  });

  describe('original instruction formatting', () => {
    it('uses blockquote format for original instruction', () => {
      const result = buildIssueDescription(baseExtracted, 'Fix the login bug');

      expect(result).toContain('> Fix the login bug');
    });

    it('includes disclaimer about verbatim transcription', () => {
      const result = buildIssueDescription(baseExtracted, 'Any text');

      expect(result).toContain(
        '_This is the original user instruction, transcribed verbatim. May include typos but preserves original observations._'
      );
    });
  });

  describe('null handling', () => {
    it('treats functionalRequirements null as absent', () => {
      const extracted: ExtractedIssueData = {
        ...baseExtracted,
        functionalRequirements: null,
      };

      const result = buildIssueDescription(extracted, 'Text');

      expect(result).not.toContain('## Functional Requirements');
    });

    it('treats technicalDetails null as absent', () => {
      const extracted: ExtractedIssueData = {
        ...baseExtracted,
        technicalDetails: null,
      };

      const result = buildIssueDescription(extracted, 'Text');

      expect(result).not.toContain('## Technical Details');
    });
  });
});
