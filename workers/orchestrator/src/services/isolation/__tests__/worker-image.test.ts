import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
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
const claudeMcpConfigPath = fileURLToPath(new URL('../../../../../../.mcp.json', import.meta.url));
const legacySentrySkillPath = fileURLToPath(
  new URL('../../../../../../.claude/skills/sentry/SKILL.md', import.meta.url)
);
const linearSentryWorkflowPath = fileURLToPath(
  new URL(
    '../../../../../../.claude/skills/linear/workflows/sentry-integration.md',
    import.meta.url
  )
);
const linearCrossLinkingPath = fileURLToPath(
  new URL('../../../../../../.claude/skills/linear/reference/cross-linking.md', import.meta.url)
);
const nitpickNukerSkillPath = fileURLToPath(
  new URL('../../../../../../.claude/skills/nitpick-nuker/SKILL.md', import.meta.url)
);

describe('code-worker image Codex skill bootstrap', () => {
  it('preserves Claude and Codex runtime dispatch with the shared MCP boundary', () => {
    const entrypoint = readFileSync(entrypointPath, 'utf8');
    const claudeMcpConfig = readFileSync(claudeMcpConfigPath, 'utf8');

    expect(entrypoint).toContain('case "${WORKER_RUNTIME:-claude}" in');
    expect(entrypoint).toContain('run_claude_attempt');
    expect(entrypoint).toContain('run_codex_attempt');
    expect(claudeMcpConfig).toContain('linear');
    expect(claudeMcpConfig).toContain('error_hub');
    expect(existsSync(nitpickNukerSkillPath)).toBe(true);
  });

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

  it('keeps the CI worker image capable of exercising the real Error Hub MCP entry', () => {
    const dockerfile = readFileSync(dockerfileTestPath, 'utf8');

    expect(dockerfile).toContain('@sentry/mcp-server@0.37.0');
    expect(dockerfile).toContain(
      'COPY --chown=claude:claude config-defaults/codex-config.toml /opt/codex-home/.codex/config.toml'
    );
    expect(dockerfile).not.toContain('@sentry/mcp-server@latest');
  });

  it('bakes and restores Codex MCP config with Linear and Error Hub access only', () => {
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
    expect(codexConfig).toContain('command = "sh"');
    expect(codexConfig).not.toContain('[mcp_servers.sentry]');
    expect(codexConfig).not.toContain('SENTRY_AUTH_TOKEN');
    expect(codexConfig).toContain('[mcp_servers.error_hub]');
    expect(codexConfig).toContain(
      'exec sentry-mcp --access-token tailnet-only --host "$ERROR_HUB_HOST" --disable-skills=seer'
    );
    expect(codexConfig).toContain('env_vars = ["ERROR_HUB_HOST"]');
    expect(codexConfig).not.toContain('npx @sentry/mcp-server');
    expect(codexConfig).not.toContain('@latest');
  });

  it('gives Claude the same direct Error Hub MCP contract as Codex', () => {
    const expectedCommand =
      'exec sentry-mcp --access-token tailnet-only --host "$ERROR_HUB_HOST" --disable-skills=seer';
    const claudeConfig = JSON.parse(readFileSync(claudeMcpConfigPath, 'utf8')) as {
      mcpServers: Record<string, { command?: string; args?: string[] }>;
    };
    const codexConfig = readFileSync(codexConfigPath, 'utf8');

    expect(Object.keys(claudeConfig.mcpServers)).toEqual(['linear', 'error_hub']);
    expect(claudeConfig.mcpServers['error_hub']).toEqual({
      command: 'sh',
      args: ['-lc', expectedCommand],
    });
    expect(codexConfig).toContain(expectedCommand);
    expect(readFileSync(dockerfilePath, 'utf8')).toContain('@sentry/mcp-server@0.37.0');
  });

  it('removes active Legacy Sentry skill routing from Claude workers', () => {
    const linearWorkflow = readFileSync(linearSentryWorkflowPath, 'utf8');
    const linearCrossLinking = readFileSync(linearCrossLinkingPath, 'utf8');

    expect(existsSync(legacySentrySkillPath)).toBe(false);
    expect(linearWorkflow).toContain('`execute_sentry_tool`');
    expect(linearWorkflow).toContain('`get_issue_details`');
    expect(linearWorkflow).not.toContain('mcp__error_hub__get_issue_details');
    expect(linearWorkflow).not.toContain('mcp__sentry__');
    expect(linearWorkflow).not.toContain('sentry.io');
    expect(linearWorkflow).not.toContain('Seer');
    expect(linearCrossLinking).toContain('SentryBox');
    expect(linearCrossLinking).not.toContain('sentry.io');
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
