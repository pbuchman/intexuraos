import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '..', '..');

function readRepoFile(path: string): string {
  return readFileSync(resolve(repoRoot, path), 'utf8');
}

describe('secret log redaction', () => {
  it('reports only whether LLM test credentials are configured', () => {
    const source = readRepoFile('scripts/test-llm-clients.ts');

    expect(source).not.toMatch(/key\.substring\(/u);
    expect(source).not.toMatch(/key\.slice\(/u);
    expect(source).toContain("return '(configured)';");
  });

  it('does not persist secret-bearing worker crash artifacts', () => {
    const source = readRepoFile('workers/orchestrator/src/services/isolation/docker-container.ts');
    const entrypoint = readRepoFile('docker/code-worker/entrypoint.sh');

    for (const candidate of [source, entrypoint]) {
      expect(candidate).not.toContain('bt full');
      expect(candidate).not.toContain('claude-debug');
      expect(candidate).not.toContain('claude-projects-repo');
      expect(candidate).not.toContain('shell-snapshots');
      expect(candidate).not.toContain('.claude.json');
      expect(candidate).not.toMatch(/cp -a .*core/u);
    }
    expect(entrypoint).toContain('umask 077');
    expect(entrypoint).toContain('chmod 700 "$out_dir"');
    expect(source).toContain("{ encoding: 'utf8', mode: 0o600 }");
  });

  it('never emits Terraform scanner matches or raw hook commands', () => {
    const scanner = readRepoFile('scripts/verify-terraform-secrets.mjs');
    const commandHook = readRepoFile('.claude/hooks/log-command-end.sh');

    expect(scanner).not.toContain('match[0].slice');
    expect(scanner).not.toContain('content: line.trim().slice');
    expect(commandHook).not.toContain('COMMAND_ESCAPED=');
    expect(commandHook).not.toContain('${COMMAND_ESCAPED:0:500}');
    expect(commandHook).toContain('command_hash=%s');
  });

  it('reports Terraform violations without echoing the matched secret', () => {
    const fixtureRoot = mkdtempSync(resolve(tmpdir(), 'terraform-secret-scan-'));
    const googleCanary = `AIza${'A'.repeat(36)}`;
    const awsCanary = `AKIA${'B'.repeat(16)}`;

    try {
      mkdirSync(resolve(fixtureRoot, 'scripts'));
      mkdirSync(resolve(fixtureRoot, 'terraform'));
      copyFileSync(
        resolve(repoRoot, 'scripts/verify-terraform-secrets.mjs'),
        resolve(fixtureRoot, 'scripts/verify-terraform-secrets.mjs')
      );
      writeFileSync(
        resolve(fixtureRoot, 'terraform/canary.tf'),
        `locals {\n  first = "${googleCanary}"\n  second = "${awsCanary}"\n}\n`
      );

      const result = spawnSync(
        process.execPath,
        [resolve(fixtureRoot, 'scripts/verify-terraform-secrets.mjs')],
        { encoding: 'utf8' }
      );
      const output = `${result.stdout}${result.stderr}`;

      expect(result.status).toBe(1);
      expect(output).toContain('canary.tf');
      expect(output).toContain('Google API Key');
      expect(output).toContain('AWS Access Key');
      expect(output).not.toContain(googleCanary);
      expect(output).not.toContain(awsCanary);
    } finally {
      rmSync(fixtureRoot, { force: true, recursive: true });
    }
  });

  it('does not print credentials embedded in a configured Git remote', () => {
    const fixtureRoot = mkdtempSync(resolve(tmpdir(), 'connection-check-'));
    const fakeBin = resolve(fixtureRoot, 'bin');
    const remoteCanary = 'REMOTE_URL_SECRET_CANARY_a3c48e';

    try {
      mkdirSync(fakeBin, { recursive: true });
      const fakeGitPath = resolve(fakeBin, 'git');
      writeFileSync(
        fakeGitPath,
        `#!/bin/sh\nif [ "$1" = "remote" ]; then printf 'origin\\thttps://user:${remoteCanary}@github.com/example/repo.git?token=${remoteCanary} (fetch)\\n'; exit 0; fi\nif [ "$1" = "ls-remote" ]; then exit 0; fi\nif [ "$1" = "check-ignore" ]; then exit 0; fi\nif [ "$1" = "branch" ]; then printf 'claude/test\\n'; exit 0; fi\nexit 0\n`,
        { mode: 0o700 }
      );

      const result = spawnSync('bash', [resolve(repoRoot, 'scripts/verify-connections.sh')], {
        encoding: 'utf8',
        env: {
          ...process.env,
          GOOGLE_APPLICATION_CREDENTIALS: '',
          HOME: fixtureRoot,
          PATH: `${fakeBin}:${process.env['PATH'] ?? ''}`,
        },
      });
      const output = `${result.stdout}${result.stderr}`;

      expect(result.status).toBe(0);
      expect(output).not.toContain(remoteCanary);
      expect(output).not.toContain('https://user:');
    } finally {
      rmSync(fixtureRoot, { force: true, recursive: true });
    }
  });

  it('never logs Linear keys or authentication signatures, including fragments', () => {
    const linearCache = readRepoFile('apps/linear-agent/src/infra/linear/requestCache.ts');
    const githubWebhook = readRepoFile(
      'apps/code-agent/src/domain/usecases/processGitHubWebhook.ts'
    );
    const hmacSigning = readRepoFile('apps/code-agent/src/infra/services/hmacSigning.ts');

    expect(linearCache).not.toContain('logger.debug({ key }');
    expect(githubWebhook).not.toContain('signatureHeader.slice');
    expect(githubWebhook).not.toContain('{ signature:');
    expect(hmacSigning).not.toContain('signature.substring');
    expect(hmacSigning).not.toContain('{ timestamp: String(timestamp), signature:');
  });
});
