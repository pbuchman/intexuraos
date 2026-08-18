import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkOpenRouterOnlyAppImports } from '../verify-llm-architecture.js';

describe('OpenRouter-only application import verifier', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  function fixture(files: Record<string, string>): string {
    const root = mkdtempSync(join(tmpdir(), 'llm-architecture-'));
    roots.push(root);
    for (const [path, source] of Object.entries(files)) {
      const absolute = join(root, path);
      mkdirSync(join(absolute, '..'), { recursive: true });
      writeFileSync(absolute, source);
    }
    return root;
  }

  it('rejects active direct-provider imports while accepting OpenRouter', () => {
    const root = fixture({
      'apps/example/src/direct.ts': "import OpenAI from 'openai';\n",
      'apps/example/src/routed.ts':
        "import { createOpenRouterClient } from '@intexuraos/infra-openrouter';\n",
    });

    expect(checkOpenRouterOnlyAppImports(root)).toEqual([
      expect.objectContaining({
        file: 'apps/example/src/direct.ts',
        line: 1,
        rule: 'RULE-6',
      }),
    ]);
  });

  it('allows only the explicit retained Research adapter files', () => {
    const root = fixture({
      'apps/research-agent/src/infra/llm/GptAdapter.ts':
        "import { createGptClient } from '@intexuraos/infra-gpt';\n",
      'apps/research-agent/src/infra/llm/ReachableGpt.ts':
        "import { createGptClient } from '@intexuraos/infra-gpt';\n",
    });

    expect(checkOpenRouterOnlyAppImports(root)).toEqual([
      expect.objectContaining({ file: 'apps/research-agent/src/infra/llm/ReachableGpt.ts' }),
    ]);
  });

  it('checks executable TSX sources without treating comments as active imports', () => {
    const root = fixture({
      'apps/example/src/direct.tsx': "export { default as OpenAI } from 'openai';\n",
      'apps/example/src/comments.ts': [
        "// import OpenAI from 'openai';",
        '/*',
        "import Anthropic from '@anthropic-ai/sdk';",
        '*/',
      ].join('\n'),
    });

    expect(checkOpenRouterOnlyAppImports(root)).toEqual([
      expect.objectContaining({ file: 'apps/example/src/direct.tsx', line: 1 }),
    ]);
  });
});
