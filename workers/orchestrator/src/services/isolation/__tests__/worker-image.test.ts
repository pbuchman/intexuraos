import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dockerfilePath = fileURLToPath(
  new URL('../../../../../code-worker/Dockerfile', import.meta.url)
);
const entrypointPath = fileURLToPath(
  new URL('../../../../../code-worker/entrypoint.sh', import.meta.url)
);

describe('code-worker image Codex skill bootstrap', () => {
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

  it('emits explicit bootstrap and runtime evidence lines for Codex runs', () => {
    const entrypoint = readFileSync(entrypointPath, 'utf8');

    expect(entrypoint).toContain('[entrypoint] Bootstrap evidence:');
    expect(entrypoint).toContain('codex_skills=');
    expect(entrypoint).toContain('github_token=');
    expect(entrypoint).toContain('[entrypoint] Codex runtime evidence:');
    expect(entrypoint).toContain('mode=');
    expect(entrypoint).toContain('thread_id=');
  });

  it('translates CODEX_REASONING_EFFORT into -c model_reasoning_effort for codex exec', () => {
    const entrypoint = readFileSync(entrypointPath, 'utf8');

    expect(entrypoint).toContain('CODEX_REASONING_EFFORT');
    expect(entrypoint).toContain('model_reasoning_effort=${CODEX_REASONING_EFFORT}');
    expect(entrypoint).toContain('"${effort_args[@]}"');
  });
});
