/**
 * Tests for verify-prompt-versions script's analyzeFile() function.
 *
 * Exercises the per-file analysis logic, especially the new
 * "unversioned-plain-builder" rule that flags any plain
 * `export function buildXxxPrompt(` without an exemption marker.
 */

import { describe, expect, it } from 'vitest';

import { analyzeFile } from '../verify-prompt-versions.mjs'; // @allow-missing-js -- .mjs import

describe('analyzeFile', () => {
  it('flags a plain builder function with kind "unversioned-plain-builder"', () => {
    const path = 'packages/llm-prompts/src/research/researchPrompt.ts';
    const content = `
export function buildResearchPrompt(userPrompt: string): string {
  return \`Research: \${userPrompt}\`;
}
`;

    const { errors } = analyzeFile(path, content);

    expect(errors).toHaveLength(1);
    expect(errors[0].kind).toBe('unversioned-plain-builder');
    expect(errors[0].path).toBe(path);
    expect(errors[0].message).toMatch(/buildResearchPrompt|plain builder|PromptBuilder/);
  });

  it('does not flag a plain builder when the exemption marker is present', () => {
    const path = 'packages/llm-prompts/src/research/researchPrompt.ts';
    const content = `// prompt-version-exempt: testing
export function buildResearchPrompt(userPrompt: string): string {
  return \`Research: \${userPrompt}\`;
}
`;

    const { errors } = analyzeFile(path, content);

    expect(errors).toHaveLength(0);
  });

  it('returns no errors for a valid PromptBuilder<> with semver version', () => {
    const path = 'packages/llm-prompts/src/foo/fooPrompt.ts';
    const content = `
export const fooPrompt: PromptBuilder<FooInput> = {
  name: 'foo',
  description: 'foo prompt',
  version: '1.0.0',
  build(input) {
    return 'foo';
  },
};
`;

    const { errors } = analyzeFile(path, content);

    expect(errors).toHaveLength(0);
  });

  it('flags missing version field in PromptBuilder', () => {
    const path = 'packages/llm-prompts/src/foo/fooPrompt.ts';
    const content = `
export const fooPrompt: PromptBuilder<FooInput> = {
  name: 'foo',
  description: 'foo prompt',
  build(input) {
    return 'foo';
  },
};
`;

    const { errors } = analyzeFile(path, content);

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].kind).toBe('missing-version');
  });

  it('returns no errors for a file with no PromptBuilder and no plain builder', () => {
    const path = 'packages/llm-prompts/src/util/helper.ts';
    const content = `
export function helperFn(x: string): string {
  return x;
}
`;

    const { errors } = analyzeFile(path, content);

    expect(errors).toHaveLength(0);
  });
});
