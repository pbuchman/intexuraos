import * as fs from 'node:fs/promises';
import { chmodSync, existsSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TASK_ACCESS_HEADER, TASK_ACCESS_TTL_MS } from '@intexuraos/code-task-domain/task-access';
import type { Task } from '../types/task.js';
import type { DispatchMetadata } from '../services/dispatch-metadata-client.js';
import { TaskAccess } from '../services/task-access.js';
import { accessConfig, accessHeaders, binding } from './task-access-fixture.js';

vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>();
  return { ...original, stat: vi.fn(original.stat), writeFile: vi.fn(original.writeFile) };
});

describe('worker task authorization', () => {
  const dirs: string[] = [];
  function setup(): ReturnType<typeof accessConfig> {
    const config = accessConfig();
    dirs.push(config.nonceDir);
    return config;
  }
  afterEach(() => {
    vi.restoreAllMocks();
    for (const dir of dirs.splice(0)) rmSync(dir, { force: true, recursive: true });
  });

  it('atomically consumes a nonce across concurrent requests and worker restarts', async () => {
    const config = setup();
    const auth = new TaskAccess(config);
    const proof = accessHeaders('DELETE', 'task-a')[TASK_ACCESS_HEADER];
    const args = [proof, 'DELETE', '/tasks/task-a', 'task-a', ''] as const;
    const attempts = await Promise.all([auth.authenticate(...args), auth.authenticate(...args)]);
    expect(attempts.filter(Boolean)).toHaveLength(1);
    const restarted = new TaskAccess(config);
    expect(await restarted.authenticate(...args)).toBeNull();
    const fresh = accessHeaders('DELETE', 'task-a')[TASK_ACCESS_HEADER];
    expect(
      await restarted.authenticate(fresh, 'DELETE', '/tasks/task-a', 'task-a', '')
    ).toMatchObject(binding);
  });

  it('prunes expired markers while preserving live or unrelated files', async () => {
    const config = setup();
    const stale = join(config.nonceDir, '00000000-0000-4000-8000-000000000001');
    const unrelated = join(config.nonceDir, 'unrelated');
    writeFileSync(stale, '');
    utimesSync(stale, 1, 1);
    writeFileSync(unrelated, '');
    const auth = new TaskAccess(config);
    const proof = accessHeaders('GET', 'task-a')[TASK_ACCESS_HEADER];
    expect(await auth.authenticate(proof, 'GET', '/tasks/task-a', 'task-a', '')).toMatchObject(
      binding
    );
    expect(existsSync(stale)).toBe(false);
    expect(existsSync(unrelated)).toBe(true);
  });

  function readStatus(auth: TaskAccess): ReturnType<TaskAccess['authenticate']> {
    const proof = accessHeaders('GET', 'task-a')[TASK_ACCESS_HEADER];
    return auth.authenticate(proof, 'GET', '/tasks/task-a', 'task-a', '');
  }

  it('refuses to record proofs in a directory accessible to other accounts', async () => {
    const config = setup();
    chmodSync(config.nonceDir, 0o755);
    await expect(readStatus(new TaskAccess(config))).rejects.toThrow('Unsafe task nonce directory');
  });

  it('tolerates a concurrently removed marker and surfaces other cleanup errors', async () => {
    const config = setup();
    writeFileSync(join(config.nonceDir, '00000000-0000-4000-8000-000000000001'), '');
    const stat = vi.mocked(fs.stat);
    stat.mockRejectedValueOnce(
      Object.assign(new Error('removed concurrently'), { code: 'ENOENT' })
    );
    expect(await readStatus(new TaskAccess(config))).toMatchObject(binding);
    stat.mockRejectedValueOnce(Object.assign(new Error('ledger I/O failed'), { code: 'EIO' }));
    await expect(readStatus(new TaskAccess(config))).rejects.toThrow('ledger I/O failed');
  });

  it('denies the operation when its nonce cannot be committed', async () => {
    vi.mocked(fs.writeFile).mockRejectedValueOnce(
      Object.assign(new Error('ledger full'), { code: 'ENOSPC' })
    );
    await expect(readStatus(new TaskAccess(setup()))).rejects.toThrow('ledger full');
  });

  it('rejects a proof that expires while its nonce is being committed', async () => {
    const issued = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(issued);
    const proof = accessHeaders('GET', 'task-a')[TASK_ACCESS_HEADER];
    const auth = new TaskAccess(setup());
    clock.mockReturnValueOnce(issued).mockReturnValue(issued + TASK_ACCESS_TTL_MS);
    expect(await auth.authenticate(proof, 'GET', '/tasks/task-a', 'task-a', '')).toBeNull();
  });

  it('corroborates pre-upgrade records through the canonical application mapping', async () => {
    const config = setup();
    const record = { taskId: 'task-a', webhookSecret: 'callback-a' } as Task;
    const canonical = {
      ownerId: binding.ownerId,
      workerLocation: binding.worker,
      taskId: 'task-a',
      webhookSecret: 'callback-a',
    } as DispatchMetadata;
    const resolveLegacy = vi.fn().mockResolvedValue(canonical);
    const auth = new TaskAccess({ ...config, resolveLegacy });
    expect(await auth.ownsTask(binding, record)).toBe(true);
    for (const different of [
      null,
      { ...canonical, taskId: 'task-b' },
      { ...canonical, ownerId: 'owner-b' },
      { ...canonical, workerLocation: 'worker-b' },
      { ...canonical, workerAudience: 'https://other.example' },
      { ...canonical, webhookSecret: 'other' },
      { ...canonical, webhookSecret: null },
      { ...canonical, ownerId: undefined },
    ]) {
      resolveLegacy.mockResolvedValueOnce(different);
      expect(await auth.ownsTask(binding, record)).toBe(false);
    }
  });
});
