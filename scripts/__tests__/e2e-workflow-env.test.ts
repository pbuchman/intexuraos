import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = process.cwd();

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

function getStartCodeAgentStep(workflow: string): string {
  const match = workflow.match(
    /- name: Start code-agent service[\s\S]*?(?=\n      - name: |\n\s*$)/
  );
  if (match === null) {
    throw new Error('Start code-agent service step not found in .github/workflows/e2e.yml');
  }
  return match[0];
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
  });
});
