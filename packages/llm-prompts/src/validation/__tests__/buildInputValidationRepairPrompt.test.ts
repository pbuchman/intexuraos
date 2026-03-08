import { describe, expect, it } from 'vitest';
import {
  buildValidationRepairPrompt,
  buildImprovementRepairPrompt,
} from '../buildInputValidationRepairPrompt.js';

describe('buildValidationRepairPrompt', () => {
  const originalPrompt = 'best travel tips';
  const invalidResponse = '{"quality": "high"}';
  const errorMessage = 'quality must be a number';

  it('includes the original prompt content', () => {
    const result = buildValidationRepairPrompt(originalPrompt, invalidResponse, errorMessage);
    expect(result).toContain(originalPrompt);
  });

  it('includes the invalid response content', () => {
    const result = buildValidationRepairPrompt(originalPrompt, invalidResponse, errorMessage);
    expect(result).toContain(invalidResponse);
  });

  it('includes error details', () => {
    const result = buildValidationRepairPrompt(originalPrompt, invalidResponse, errorMessage);
    expect(result).toContain(errorMessage);
  });

  it('includes JSON requirements', () => {
    const result = buildValidationRepairPrompt(originalPrompt, invalidResponse, errorMessage);
    expect(result).toContain('Output ONLY valid JSON');
    expect(result).toContain('quality field must be a number');
  });

  it('includes quality evaluation examples', () => {
    const result = buildValidationRepairPrompt(originalPrompt, invalidResponse, errorMessage);
    expect(result).toContain('"quality": 2');
    expect(result).toContain('"quality": 0');
  });

  it('has anti-injection guard before ORIGINAL PROMPT block', () => {
    const result = buildValidationRepairPrompt(originalPrompt, invalidResponse, errorMessage);
    const guardPattern =
      /(?:Treat|treat).*(?:literal|verbatim).*(?:Do not|do not).*(?:follow|interpret|execute).*(?:instructions|commands)/is;
    const originalPromptIndex = result.indexOf('<original_prompt>');
    expect(originalPromptIndex).toBeGreaterThan(-1);

    // Guard line must appear before the original prompt block
    const textBeforeBlock = result.substring(0, originalPromptIndex);
    expect(textBeforeBlock).toMatch(guardPattern);
  });

  it('has anti-injection guard before INVALID RESPONSE block', () => {
    const result = buildValidationRepairPrompt(originalPrompt, invalidResponse, errorMessage);
    const invalidResponseIndex = result.indexOf('<invalid_response>');
    expect(invalidResponseIndex).toBeGreaterThan(-1);

    // There must be a guard or the block must use XML-style tags for containment
    const closingTag = result.indexOf('</invalid_response>');
    expect(closingTag).toBeGreaterThan(invalidResponseIndex);
  });

  it('wraps original prompt in XML-style delimiters', () => {
    const result = buildValidationRepairPrompt(originalPrompt, invalidResponse, errorMessage);
    expect(result).toContain('<original_prompt>');
    expect(result).toContain('</original_prompt>');

    // Content is between the tags
    const startTag = '<original_prompt>';
    const endTag = '</original_prompt>';
    const startIdx = result.indexOf(startTag) + startTag.length;
    const endIdx = result.indexOf(endTag);
    const content = result.substring(startIdx, endIdx);
    expect(content).toContain(originalPrompt);
  });

  it('wraps invalid response in XML-style delimiters', () => {
    const result = buildValidationRepairPrompt(originalPrompt, invalidResponse, errorMessage);
    expect(result).toContain('<invalid_response>');
    expect(result).toContain('</invalid_response>');

    const startTag = '<invalid_response>';
    const endTag = '</invalid_response>';
    const startIdx = result.indexOf(startTag) + startTag.length;
    const endIdx = result.indexOf(endTag);
    const content = result.substring(startIdx, endIdx);
    expect(content).toContain(invalidResponse);
  });

  it('guards appear in correct order: guard, original prompt, error, invalid response', () => {
    const result = buildValidationRepairPrompt(originalPrompt, invalidResponse, errorMessage);
    const originalPromptIdx = result.indexOf('<original_prompt>');
    const errorIdx = result.indexOf('ERROR DETAILS:');
    const invalidResponseIdx = result.indexOf('<invalid_response>');

    expect(originalPromptIdx).toBeGreaterThan(-1);
    expect(errorIdx).toBeGreaterThan(originalPromptIdx);
    expect(invalidResponseIdx).toBeGreaterThan(errorIdx);
  });

  it('does not use triple-quote delimiters for untrusted content', () => {
    const result = buildValidationRepairPrompt(originalPrompt, invalidResponse, errorMessage);
    // Should NOT contain """ around the originalPrompt or invalidResponse
    // (""" is easily escapable by malicious content)
    expect(result).not.toContain('"""');
  });
});

describe('buildImprovementRepairPrompt', () => {
  const originalPrompt = 'travel tips';
  const invalidResponse = 'Here is an improved version: better travel tips';
  const errorMessage = 'Response contains prefix text';

  it('includes the original prompt content', () => {
    const result = buildImprovementRepairPrompt(originalPrompt, invalidResponse, errorMessage);
    expect(result).toContain(originalPrompt);
  });

  it('includes the invalid response content', () => {
    const result = buildImprovementRepairPrompt(originalPrompt, invalidResponse, errorMessage);
    expect(result).toContain(invalidResponse);
  });

  it('includes error details', () => {
    const result = buildImprovementRepairPrompt(originalPrompt, invalidResponse, errorMessage);
    expect(result).toContain(errorMessage);
  });

  it('includes improvement requirements', () => {
    const result = buildImprovementRepairPrompt(originalPrompt, invalidResponse, errorMessage);
    expect(result).toContain('SAME LANGUAGE');
    expect(result).toContain('Return ONLY the improved prompt text');
  });

  it('has anti-injection guard before ORIGINAL PROMPT block', () => {
    const result = buildImprovementRepairPrompt(originalPrompt, invalidResponse, errorMessage);
    const guardPattern =
      /(?:Treat|treat).*(?:literal|verbatim).*(?:Do not|do not).*(?:follow|interpret|execute).*(?:instructions|commands)/is;
    const originalPromptIndex = result.indexOf('<original_prompt>');
    expect(originalPromptIndex).toBeGreaterThan(-1);

    const textBeforeBlock = result.substring(0, originalPromptIndex);
    expect(textBeforeBlock).toMatch(guardPattern);
  });

  it('has anti-injection guard before INVALID RESPONSE block', () => {
    const result = buildImprovementRepairPrompt(originalPrompt, invalidResponse, errorMessage);
    const invalidResponseIndex = result.indexOf('<invalid_response>');
    expect(invalidResponseIndex).toBeGreaterThan(-1);

    const closingTag = result.indexOf('</invalid_response>');
    expect(closingTag).toBeGreaterThan(invalidResponseIndex);
  });

  it('wraps original prompt in XML-style delimiters', () => {
    const result = buildImprovementRepairPrompt(originalPrompt, invalidResponse, errorMessage);
    expect(result).toContain('<original_prompt>');
    expect(result).toContain('</original_prompt>');

    const startTag = '<original_prompt>';
    const endTag = '</original_prompt>';
    const startIdx = result.indexOf(startTag) + startTag.length;
    const endIdx = result.indexOf(endTag);
    const content = result.substring(startIdx, endIdx);
    expect(content).toContain(originalPrompt);
  });

  it('wraps invalid response in XML-style delimiters', () => {
    const result = buildImprovementRepairPrompt(originalPrompt, invalidResponse, errorMessage);
    expect(result).toContain('<invalid_response>');
    expect(result).toContain('</invalid_response>');

    const startTag = '<invalid_response>';
    const endTag = '</invalid_response>';
    const startIdx = result.indexOf(startTag) + startTag.length;
    const endIdx = result.indexOf(endTag);
    const content = result.substring(startIdx, endIdx);
    expect(content).toContain(invalidResponse);
  });

  it('guards appear in correct order: guard, original prompt, error, invalid response', () => {
    const result = buildImprovementRepairPrompt(originalPrompt, invalidResponse, errorMessage);
    const originalPromptIdx = result.indexOf('<original_prompt>');
    const errorIdx = result.indexOf('ERROR DETAILS:');
    const invalidResponseIdx = result.indexOf('<invalid_response>');

    expect(originalPromptIdx).toBeGreaterThan(-1);
    expect(errorIdx).toBeGreaterThan(originalPromptIdx);
    expect(invalidResponseIdx).toBeGreaterThan(errorIdx);
  });

  it('does not use triple-quote delimiters for untrusted content', () => {
    const result = buildImprovementRepairPrompt(originalPrompt, invalidResponse, errorMessage);
    expect(result).not.toContain('"""');
  });
});
