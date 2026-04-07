import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(new URL('../../../../scripts/codex-login.sh', import.meta.url));

describe('codex-login.sh', () => {
  it('uses ChatGPT device auth only for shared Codex bootstrap', () => {
    const script = readFileSync(scriptPath, 'utf8');

    expect(script).toContain('echo "Run \'codex login --device-auth\' and follow the prompts."');
    expect(script).not.toContain('OPENAI_API_KEY detected');
    expect(script).not.toContain('No OPENAI_API_KEY detected');
    expect(script).not.toContain('codex login --with-api-key');
    expect(script).not.toContain('printenv OPENAI_API_KEY');
  });
});
