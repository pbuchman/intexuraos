import { mkdtemp, rm, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkerTypeDisabledError, WorkerTypePolicy } from '../../services/worker-type-policy.js';
import { createDeferred } from '../deferred.js';

describe('WorkerTypePolicy', () => {
  let directory: string;
  let filePath: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'worker-type-policy-'));
    filePath = join(directory, 'worker-types.json');
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('defaults to all worker types on an existing host with no policy file', async () => {
    const policy = await WorkerTypePolicy.load(filePath);
    expect(policy.snapshot()).toEqual({
      enabledWorkerTypes: ['auto', 'opus', 'sonnet', 'codex', 'codex-xhigh', 'openrouter-free'],
      workerTypesRevision: 0,
    });
  });

  it('fails startup if a parent path blocks access to the policy file', async () => {
    await writeFile(filePath, '{}');

    await expect(WorkerTypePolicy.load(join(filePath, 'worker-types.json'))).rejects.toMatchObject({
      code: 'ENOTDIR',
    });
  });

  it('preserves the persisted policy when its revision cannot be incremented safely', async () => {
    const current = {
      enabledWorkerTypes: ['codex'],
      workerTypesRevision: Number.MAX_SAFE_INTEGER,
    };
    await writeFile(filePath, JSON.stringify(current));
    const policy = await WorkerTypePolicy.load(filePath);

    await expect(policy.apply([], Number.MAX_SAFE_INTEGER)).rejects.toThrow(
      'Worker type policy revision limit reached'
    );
    expect(policy.snapshot()).toEqual(current);
    expect(JSON.parse(await readFile(filePath, 'utf8'))).toEqual(current);
  });

  it('persists an empty allowlist before resolving and reloads it at startup', async () => {
    const policy = await WorkerTypePolicy.load(filePath);
    const applied = { enabledWorkerTypes: [], workerTypesRevision: 1 };

    await expect(policy.apply([], 0)).resolves.toEqual(applied);
    expect(JSON.parse(await readFile(filePath, 'utf8'))).toEqual(applied);
    expect((await WorkerTypePolicy.load(filePath)).snapshot()).toEqual(applied);
  });

  it('accepts a retry of the same enabled set and rejects competing revisions', async () => {
    const policy = await WorkerTypePolicy.load(filePath);
    const applied = { enabledWorkerTypes: ['codex', 'openrouter-free'], workerTypesRevision: 1 };

    await expect(policy.apply(['openrouter-free', 'codex'], 0)).resolves.toEqual(applied);
    await expect(policy.apply(['codex', 'openrouter-free'], 0)).resolves.toEqual(applied);
    await expect(policy.apply(['opus'], 0)).resolves.toBeNull();
    await expect(policy.apply(['codex', 'openrouter-free'], 9)).resolves.toBeNull();
    expect(policy.snapshot()).toEqual(applied);
  });

  it.each([
    '{unfinished',
    '{"enabledWorkerTypes":["obsolete"],"workerTypesRevision":1}',
    '{"enabledWorkerTypes":["codex","codex"],"workerTypesRevision":1}',
    '{"workerTypesRevision":1}',
  ])('fails closed on a corrupt policy file (%s)', async (contents) => {
    await writeFile(filePath, contents);
    await expect(WorkerTypePolicy.load(filePath)).rejects.toThrow('Invalid worker type policy');
    expect(await readFile(filePath, 'utf8')).toBe(contents);
  });

  it('retains the live policy when disk persistence fails', async () => {
    const policy = await WorkerTypePolicy.load(filePath);
    await mkdir(filePath);

    await expect(policy.apply([], 0)).rejects.toThrow();
    expect(policy.isEnabled('codex')).toBe(true);
    expect(policy.snapshot().workerTypesRevision).toBe(0);
  });

  it('waits for a starting attempt and prevents starts queued behind a disable', async () => {
    const policy = await WorkerTypePolicy.load(filePath);
    const launch = createDeferred<string>();
    const first = policy.withStart('opus', async () => await launch.promise);
    await expect(policy.withStart('codex', async () => 'codex started')).resolves.toBe(
      'codex started'
    );
    const disable = policy.apply(['codex'], 0);
    const start = vi.fn(async () => 'unexpected launch');
    const blocked = expect(policy.withStart('opus', start)).rejects.toBeInstanceOf(
      WorkerTypeDisabledError
    );

    expect(policy.isEnabled('opus')).toBe(true);
    launch.resolve('first attempt started');

    await expect(first).resolves.toBe('first attempt started');
    await expect(disable).resolves.toEqual({
      enabledWorkerTypes: ['codex'],
      workerTypesRevision: 1,
    });
    await blocked;
    expect(start).not.toHaveBeenCalled();
    await expect(policy.withStart('codex', async () => 'codex started')).resolves.toBe(
      'codex started'
    );
  });
});
