import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const SCRIPT = path.resolve(import.meta.dirname, '..', 'verify-removed-agents.mjs');
const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');

function writeFixture(rootDir: string, relativePath: string, body: string): void {
  const fullPath = path.join(rootDir, relativePath);
  mkdirSync(path.dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, body);
}

function runVerifier(rootDir: string): SpawnSyncReturns<string> {
  return spawnSync('node', [SCRIPT, '--root', rootDir], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

describe('verify-removed-agents', () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = mkdtempSync(path.join(tmpdir(), 'verify-removed-agents-'));
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('fails when removed runtime names, routes, topics, or Firestore rows remain', () => {
    writeFixture(rootDir, 'apps/actions-agent/package.json', '{}');
    writeFixture(
      rootDir,
      'docker/README.md',
      `
The local bridge forwards actions-queue messages to /internal/actions/process.
`
    );
    writeFixture(
      rootDir,
      'workers/transcription/src/providers/speechmatics/vocabulary.ts',
      `
export const REMOVED_WORDS = ['commands-agent'];
`
    );
    writeFixture(
      rootDir,
      'ecosystem.config.cjs',
      `
module.exports = {
  apps: [{ name: 'commands-agent', env: { INTEXURAOS_PUBSUB_COMMANDS_INGEST_TOPIC: 'commands-ingest' } }],
};
`
    );
    writeFixture(
      rootDir,
      'terraform/environments/dev/main.tf',
      `
resource "google_pubsub_subscription" "approval_reply" {
  push_endpoint = "/internal/actions/approval-reply"
}

output "pubsub_actions_queue_topic" {
  value = module.pubsub_actions_queue.topic_name
}
`
    );
    writeFixture(
      rootDir,
      'packages/llm-prompts/src/index.ts',
      `
export { commandClassifierPrompt } from './classification/index.js';
export { approvalIntentPrompt } from './approvals/index.js';
`
    );
    writeFixture(
      rootDir,
      'scripts/reset-actions-status.mjs',
      `
db.collection('actions');
db.collection("commands");
`
    );
    writeFixture(
      rootDir,
      'docs/validation/route-auth-validation.md',
      `
### actions-agent
POST /internal/actions/process
`
    );
    writeFixture(
      rootDir,
      'firestore-collections.json',
      JSON.stringify([{ collection: 'actions', owner: 'actions-agent' }], null, 2)
    );

    const result = runVerifier(rootDir);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('apps/actions-agent: removed agent path still exists');
    expect(result.stderr).toContain('commands-agent');
    expect(result.stderr).toContain('INTEXURAOS_PUBSUB_COMMANDS_INGEST_TOPIC');
    expect(result.stderr).toContain('/internal/actions');
    expect(result.stderr).toContain('docker/README.md');
    expect(result.stderr).toContain(
      'workers/transcription/src/providers/speechmatics/vocabulary.ts'
    );
    expect(result.stderr).toContain('module.pubsub_actions_queue');
    expect(result.stderr).toContain('commandClassifierPrompt');
    expect(result.stderr).toContain('approvalIntentPrompt');
    expect(result.stderr).toContain("collection('actions')");
    expect(result.stderr).toContain('collection("commands")');
    expect(result.stderr).toContain('docs/validation/route-auth-validation.md');
    expect(result.stderr).toContain('"actions"');
  });

  it('passes when only Intex runtime names remain', () => {
    writeFixture(
      rootDir,
      'apps/intex-agent/src/index.ts',
      `
const REQUIRED_ENV = ['INTEXURAOS_INTEX_AGENT_URL'];
fastify.post('/internal/intex-agent/messages', async () => ({}));
const receipt = command.ingestReceiptId;
`
    );
    writeFixture(
      rootDir,
      'firestore-collections.json',
      JSON.stringify([{ collection: 'intex_agent_sessions', owner: 'intex-agent' }], null, 2)
    );

    const result = runVerifier(rootDir);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Removed agent verification passed');
  });

  it('ignores generated or installed files left under removed package directories', () => {
    writeFixture(rootDir, 'apps/actions-agent/node_modules/some-package/index.js', '');
    writeFixture(rootDir, 'apps/actions-agent/dist/package.json', '{"name":"ignored"}');
    writeFixture(rootDir, 'apps/commands-agent/node_modules/some-package/index.js', '');
    writeFixture(rootDir, 'apps/commands-agent/dist/package.json', '{"name":"ignored"}');

    const result = runVerifier(rootDir);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Removed agent verification passed');
  });

  it('allows only the explicit Terraform retired async cleanup inventory to name deleted resources', () => {
    writeFixture(
      rootDir,
      'terraform/hetzner-prod/retired-async-cleanup.tf',
      `
locals {
  retired_prod_hetzner_pubsub_subscriptions = {
    commands_ingest = {
      subscription_name = "intexuraos-commands-ingest-prod-hetzner"
      push_path         = "/internal/commands"
    }
    actions_queue = {
      subscription_name = "intexuraos-actions-queue-prod-hetzner"
      push_path         = "/internal/actions/process"
    }
  }
}
`
    );

    const result = runVerifier(rootDir);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Removed agent verification passed');
  });

  it('passes on the repository root after the removed agents cleanup is complete', () => {
    const result = runVerifier(REPO_ROOT);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  });
});
