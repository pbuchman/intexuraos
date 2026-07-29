import { describe, expect, it } from 'vitest';

// @ts-expect-error vite raw import has no type declaration
import formSource from '../components/message-digests/MessageDigestDefinitionForm.tsx?raw'; // @allow-missing-js -- vite '?raw' query import
// @ts-expect-error vite raw import has no type declaration
import promptsPackageSource from '../../../../packages/llm-prompts/package.json?raw'; // @allow-missing-js -- vite '?raw' query import
// @ts-expect-error vite raw import has no type declaration
import templatesSource from '../../../../packages/llm-prompts/src/message-digest/templates.ts?raw'; // @allow-missing-js -- vite '?raw' query import

interface PromptPackageManifest {
  exports: Record<string, string>;
}

describe('Message Digest browser import boundary', () => {
  it('exports the constant template module without traversing the server prompt barrel', () => {
    const manifest = JSON.parse(promptsPackageSource) as PromptPackageManifest;

    expect(manifest.exports['./message-digest/templates']).toBe(
      './src/message-digest/templates.ts'
    );
    expect(templatesSource).not.toMatch(/from ['"]node:/u);
    expect(templatesSource).not.toContain("export * from '../index.js'");
  });

  it('imports Message Digest templates only through the browser-safe subpath', () => {
    expect(formSource).toContain(
      "from '@intexuraos/llm-prompts/message-digest/templates';"
    );
    expect(formSource).not.toMatch(/from ['"]@intexuraos\/llm-prompts['"]/u);
  });
});
