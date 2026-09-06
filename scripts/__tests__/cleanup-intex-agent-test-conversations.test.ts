import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  parseArgs,
  readServiceAccountInfo,
  runCleanup,
  validateCleanupRequest,
} from '../cleanup-intex-agent-test-conversations.mjs';

const firebaseFakes = vi.hoisted(() => ({
  cert: vi.fn(),
  getApps: vi.fn(() => [{}]),
  initializeApp: vi.fn(),
  getFirestore: vi.fn(),
}));

vi.mock('firebase-admin/app', () => ({
  cert: firebaseFakes.cert,
  getApps: firebaseFakes.getApps,
  initializeApp: firebaseFakes.initializeApp,
}));

vi.mock('firebase-admin/firestore', () => ({ getFirestore: firebaseFakes.getFirestore }));

describe('cleanup-intex-agent-test-conversations', () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    for (const root of tempRoots) {
      rmSync(root, { recursive: true, force: true });
    }
    tempRoots.length = 0;
    vi.restoreAllMocks();
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

  it('routes every cleanup line to an injected writer without touching console', async () => {
    const credentialPath = createServiceAccountFile(tempRoots);
    firebaseFakes.getFirestore.mockReturnValue(fakeFirestore());
    const lines: string[] = [];
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await expect(
      runCleanup(
        parseArgs([
          '--user-id',
          'test-intex-agent-run-1',
          '--run-id',
          'run-1',
          '--credentials',
          credentialPath,
        ]),
        { writeLine: (line: string) => lines.push(line) }
      )
    ).resolves.toEqual({ deleted: 0, total: 3 });

    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({
      userId: 'test-intex-agent-run-1',
      runId: 'run-1',
      mode: 'dry-run',
      total: 3,
    });
    expect(lines[1]).toBe('Dry run only. Re-run with --execute to delete matching test documents.');
    expect(consoleLog).not.toHaveBeenCalled();
  });

  it('preserves direct CLI-style console output when no writer is injected', async () => {
    const credentialPath = createServiceAccountFile(tempRoots);
    firebaseFakes.getFirestore.mockReturnValue(fakeFirestore());
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await runCleanup(
      parseArgs([
        '--user-id',
        'test-intex-agent-run-1',
        '--run-id',
        'run-1',
        '--credentials',
        credentialPath,
      ])
    );

    expect(consoleLog).toHaveBeenCalledTimes(2);
    expect(consoleLog.mock.calls[1]?.[0]).toBe(
      'Dry run only. Re-run with --execute to delete matching test documents.'
    );
  });
});

function createServiceAccountFile(tempRoots: string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'intex-cleanup-run-'));
  tempRoots.push(root);
  const credentialPath = join(root, 'credentials.json');
  writeFileSync(
    credentialPath,
    JSON.stringify({
      type: 'service_account',
      client_email: 'synthetic@example.iam.gserviceaccount.com',
      project_id: 'synthetic-project',
    })
  );
  return credentialPath;
}

function fakeFirestore() {
  const documentsByCollection: Record<string, unknown[]> = {
    intex_agent_sessions: [{ ref: { delete: vi.fn() } }],
    intex_agent_session_events: [{ ref: { delete: vi.fn() } }],
    intex_agent_prompt_preference_versions: [],
  };
  return {
    collection(name: string) {
      if (name === 'intex_agent_prompt_preferences') {
        return { doc: () => ({ get: async () => ({ exists: true, ref: { delete: vi.fn() } }) }) };
      }
      return {
        where: () => ({ get: async () => ({ docs: documentsByCollection[name] ?? [] }) }),
      };
    },
  };
}
