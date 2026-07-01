import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  parseArgs,
  readServiceAccountInfo,
  validateCleanupRequest,
} from '../cleanup-intex-agent-test-conversations.mjs';

describe('cleanup-intex-agent-test-conversations', () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    for (const root of tempRoots) {
      rmSync(root, { recursive: true, force: true });
    }
    tempRoots.length = 0;
  });

  it('defaults to dry-run and parses explicit execute mode', () => {
    expect(parseArgs(['--user-id', 'test-intex-agent-run-1', '--run-id', 'run-1'])).toMatchObject({
      userId: 'test-intex-agent-run-1',
      runId: 'run-1',
      dryRun: true,
      execute: false,
    });
    expect(
      parseArgs(['--user-id', 'test-intex-agent-run-1', '--run-id', 'run-1', '--execute'])
    ).toMatchObject({
      dryRun: false,
      execute: true,
    });
  });

  it('uses the last explicit cleanup mode flag', () => {
    expect(
      parseArgs([
        '--user-id',
        'test-intex-agent-run-1',
        '--run-id',
        'run-1',
        '--execute',
        '--dry-run',
      ])
    ).toMatchObject({
      dryRun: true,
      execute: false,
    });
    expect(
      parseArgs([
        '--user-id',
        'test-intex-agent-run-1',
        '--run-id',
        'run-1',
        '--dry-run',
        '--execute',
      ])
    ).toMatchObject({
      dryRun: false,
      execute: true,
    });
  });

  it('rejects product users and test users that do not exactly match the run id', () => {
    expect(() => validateCleanupRequest({ userId: 'auth0|real-user', runId: 'real' })).toThrow(
      'outside the allowed test-intex-agent namespace'
    );
    expect(() =>
      validateCleanupRequest({ userId: 'test-intex-agent-other', runId: 'run-1' })
    ).toThrow('must equal test-intex-agent-<runId>');
    expect(() =>
      validateCleanupRequest({ userId: 'test-intex-agent-agent', runId: 'agent' })
    ).not.toThrow();
  });

  it('requires service-account credentials', () => {
    const root = mkdtempSync(join(tmpdir(), 'intex-cleanup-'));
    tempRoots.push(root);
    const credentialPath = join(root, 'credentials.json');
    writeFileSync(credentialPath, JSON.stringify({ type: 'authorized_user' }));

    expect(() => readServiceAccountInfo(credentialPath)).toThrow(
      'requires a service_account credential file'
    );

    writeFileSync(
      credentialPath,
      JSON.stringify({
        type: 'service_account',
        client_email: 'test@example.iam.gserviceaccount.com',
        project_id: 'intexuraos-dev-pbuchman',
      })
    );
    expect(readServiceAccountInfo(credentialPath)).toMatchObject({
      type: 'service_account',
      project_id: 'intexuraos-dev-pbuchman',
    });
  });
});
