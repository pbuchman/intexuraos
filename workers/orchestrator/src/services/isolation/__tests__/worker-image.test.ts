import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dockerfilePath = fileURLToPath(
  new URL('../../../../../claude-worker/Dockerfile', import.meta.url)
);
const entrypointPath = fileURLToPath(
  new URL('../../../../../claude-worker/entrypoint.sh', import.meta.url)
);

describe('claude-worker image Codex skill bootstrap', () => {
  it('stages Superpowers for Codex native skill discovery at build time', () => {
    const dockerfile = readFileSync(dockerfilePath, 'utf8');

    expect(dockerfile).toContain(
      'git clone --depth 1 https://github.com/obra/superpowers.git /opt/codex-superpowers'
    );
    expect(dockerfile).toContain('mkdir -p /opt/codex-home/.agents/skills');
    expect(dockerfile).toContain(
      'ln -s /opt/codex-superpowers/skills /opt/codex-home/.agents/skills/superpowers'
    );
  });

  it('restores the staged Codex skill discovery directory into the runtime home', () => {
    const entrypoint = readFileSync(entrypointPath, 'utf8');

    expect(entrypoint).toContain(
      'mkdir -p /home/claude/.config/gcloud /home/claude/.claude /home/claude/.agents/skills'
    );
    expect(entrypoint).toContain('cp -a /opt/codex-home/.agents/. /home/claude/.agents/');
    expect(entrypoint).toContain('Codex skill discovery restored');
  });
});
