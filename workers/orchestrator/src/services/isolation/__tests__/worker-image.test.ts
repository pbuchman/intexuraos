import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dockerfilePath = fileURLToPath(
  new URL('../../../../../../docker/code-worker/Dockerfile', import.meta.url)
);
const dockerfileTestPath = fileURLToPath(
  new URL('../../../../../../docker/code-worker/Dockerfile.test', import.meta.url)
);
const entrypointPath = fileURLToPath(
  new URL('../../../../../../docker/code-worker/entrypoint.sh', import.meta.url)
);
const codexConfigPath = fileURLToPath(
  new URL('../../../../../../docker/code-worker/config-defaults/codex-config.toml', import.meta.url)
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
      'mkdir -p /home/claude/.config/gcloud /home/claude/.claude /home/claude/.codex /home/claude/.agents/skills'
    );
    expect(entrypoint).toContain('cp -a /opt/codex-home/.agents/. /home/claude/.agents/');
    expect(entrypoint).toContain('Codex skill discovery restored');
  });

  it('pins the Sentry MCP server in the image instead of installing latest at runtime', () => {
    const dockerfile = readFileSync(dockerfilePath, 'utf8');

    expect(dockerfile).toContain('@sentry/mcp-server@0.37.0');
    expect(dockerfile).not.toContain('@sentry/mcp-server@latest');
  });

  it('bakes and restores Codex MCP config with Linear, Sentry, and Error Hub access', () => {
    const dockerfile = readFileSync(dockerfilePath, 'utf8');
    const entrypoint = readFileSync(entrypointPath, 'utf8');
    const codexConfig = readFileSync(codexConfigPath, 'utf8');

    expect(dockerfile).toContain(
      'COPY --chown=claude:claude docker/code-worker/config-defaults/codex-config.toml /opt/codex-home/.codex/config.toml'
    );
    expect(entrypoint).toContain('/home/claude/.codex');
    expect(entrypoint).toContain('cp -a /opt/codex-home/.codex/. /home/claude/.codex/');
    expect(codexConfig).toContain('[mcp_servers.linear]');
    expect(codexConfig).toContain('bearer_token_env_var = "LINEAR_API_KEY"');
    expect(codexConfig).toContain('[mcp_servers.sentry]');
    expect(codexConfig).toContain('command = "sh"');
    expect(codexConfig).toContain('exec sentry-mcp --access-token "$SENTRY_AUTH_TOKEN"');
    expect(codexConfig).toContain('[mcp_servers.error_hub]');
    expect(codexConfig).toContain(
      'exec sentry-mcp --access-token tailnet-only --host "$ERROR_HUB_HOST" --disable-skills=seer'
    );
    expect(codexConfig).not.toContain('npx @sentry/mcp-server');
    expect(codexConfig).not.toContain('@latest');
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

  it('streams Codex output live instead of buffering to a temp file', () => {
    const entrypoint = readFileSync(entrypointPath, 'utf8');

    // Forensics path: output piped through tee for live streaming + log capture
    expect(entrypoint).toContain('| tee -a "${attempt_forensics_dir}/codex-stream.log"');

    // No temp file buffering pattern (the old approach used mktemp + cat)
    expect(entrypoint).not.toContain('mktemp /tmp/codex-output');
    expect(entrypoint).not.toMatch(/> "\$log_file"/);
    expect(entrypoint).not.toMatch(/cat "\$log_file"/);
  });

  it('preserves the Codex exit code through the pipe via PIPESTATUS', () => {
    const entrypoint = readFileSync(entrypointPath, 'utf8');

    // PIPESTATUS[0] captures the exit code of the first command in the pipe
    expect(entrypoint).toContain('raw_exit=${PIPESTATUS[0]}');

    // Exit code is used for the return value
    expect(entrypoint).toContain('return "$raw_exit"');
  });

  it('relies on the staged npmrc for pnpm store configuration instead of global config writes', () => {
    const dockerfile = readFileSync(dockerfilePath, 'utf8');
    const entrypoint = readFileSync(entrypointPath, 'utf8');

    expect(dockerfile).toContain(
      'COPY --chown=claude:claude docker/code-worker/.npmrc /opt/claude-defaults/.npmrc'
    );
    expect(entrypoint).not.toContain('pnpm config set store-dir /home/claude/pnpm-store --global');
  });

  it('includes a codex stub in the test Dockerfile for E2E Codex-path coverage', () => {
    const dockerfileTest = readFileSync(dockerfileTestPath, 'utf8');

    expect(dockerfileTest).toContain('COPY test-fixtures/codex-stub.sh /usr/local/bin/codex');
    expect(dockerfileTest).toContain('chmod +x /usr/local/bin/codex');
  });
});
