import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '..', '..');
const pubsubUiSource = readFileSync(resolve(repoRoot, 'tools/pubsub-ui/server.mjs'), 'utf8');

interface DevAppConfig {
  name: string;
  env: Record<string, string | undefined>;
}

function loadDevConfig(): { apps: DevAppConfig[] } {
  const stdout = execFileSync(
    process.execPath,
    [
      '-e',
      `
        const config = require('./ecosystem.config.cjs');
        process.stdout.write(JSON.stringify(config));
      `,
    ],
    {
      cwd: repoRoot,
      env: {
        HOME: process.env.HOME ?? '/tmp',
        PATH: process.env.PATH ?? '',
      },
    }
  );

  return JSON.parse(stdout.toString()) as { apps: DevAppConfig[] };
}

describe('local Pub/Sub configuration', () => {
  it('uses a local emulator alias for code-agent PR triage', () => {
    const codeAgent = loadDevConfig().apps.find((app) => app.name === 'code-agent');

    expect(codeAgent?.env.PUBSUB_EMULATOR_HOST).toBe('localhost:8102');
    expect(codeAgent?.env.INTEXURAOS_PUBSUB_PR_TRIAGE_TOPIC).toBe('pr-triage');
  });

  it('creates and forwards the PR triage topic in the local Pub/Sub UI', () => {
    expect(pubsubUiSource).toContain("'pr-triage'");
    expect(pubsubUiSource).toContain(
      "'pr-triage': 'http://host.docker.internal:8128/internal/code/pubsub/pr-triage'"
    );
  });

  it('forwards local Pub/Sub pushes with the trusted Google provenance marker', () => {
    expect(pubsubUiSource).toContain("From: 'noreply@google.com'");
    expect(pubsubUiSource).toContain("'X-Internal-Auth': INTEXURAOS_INTERNAL_AUTH_TOKEN");
  });

  it('never logs a fragment of the internal authentication token', () => {
    expect(pubsubUiSource).not.toMatch(/INTEXURAOS_INTERNAL_AUTH_TOKEN\.slice/u);
    expect(pubsubUiSource).not.toContain("'***' + INTEXURAOS_INTERNAL_AUTH_TOKEN");
    expect(pubsubUiSource).toContain("INTEXURAOS_INTERNAL_AUTH_TOKEN ? 'CONFIGURED' : 'NOT SET'");
  });
});
