import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = process.cwd();

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

function getStartCodeAgentStep(workflow: string): string {
  const match = workflow.match(/- name: Start code-agent service[\s\S]*?(?=\n {6}- name: |\n\s*$)/);
  if (match === null) {
    throw new Error('Start code-agent service step not found in .github/workflows/e2e.yml');
  }
  return match[0];
}

function getConstArray(source: string, name: string): string {
  const match = source.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`));
  if (match === null || match[1] === undefined) {
    throw new Error(`${name} not found`);
  }
  return match[1];
}

describe('E2E workflow code-agent startup env', () => {
  it('passes the required public URLs to the code-agent startup command', () => {
    const workflow = readRepoFile('.github/workflows/e2e.yml');
    const startCodeAgentStep = getStartCodeAgentStep(workflow);

    expect(startCodeAgentStep).toContain('INTEXURAOS_SERVICE_URL=http://127.0.0.1:8128 \\');
    expect(startCodeAgentStep).toContain(
      'INTEXURAOS_CODE_TASK_CALLBACK_BASE_URL=http://127.0.0.1:8128 \\'
    );
    expect(startCodeAgentStep).toContain('INTEXURAOS_WEB_APP_URL=');
    expect(startCodeAgentStep).toContain('INTEXURAOS_WEB_APP_URL=http://localhost:3000 \\');
    expect(startCodeAgentStep).not.toContain('dev.intexuraos.cloud');
  });

  it('does not require Sentry automation env vars during E2E startup', () => {
    const indexSource = readRepoFile('apps/code-agent/src/index.ts');
    const requiredEnv = getConstArray(indexSource, 'REQUIRED_ENV');
    const productionOnlyEnv = getConstArray(indexSource, 'PRODUCTION_ONLY_ENV');
    const sentryEnvVars = [
      'INTEXURAOS_SENTRY_WEBHOOK_SECRET',
      'INTEXURAOS_SENTRY_AUTOMATION_USER_ID',
      'INTEXURAOS_SENTRY_CODE_TASK_REPOSITORY',
      'INTEXURAOS_SENTRY_CODE_TASK_BASE_BRANCH',
    ];

    for (const envVar of sentryEnvVars) {
      expect(requiredEnv).not.toContain(envVar);
      expect(productionOnlyEnv).toContain(envVar);
    }
  });
});
