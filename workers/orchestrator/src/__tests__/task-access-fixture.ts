import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { signTaskAccess, TASK_ACCESS_HEADER } from '@intexuraos/code-task-domain/task-access';
import type { TaskAccessConfig } from '../services/task-access.js';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
export const binding = {
  ownerId: 'owner-a',
  worker: 'worker-a',
  audience: 'https://worker.example',
};
export function accessConfig(): TaskAccessConfig {
  return {
    key: publicKey,
    audience: binding.audience,
    nonceDir: mkdtempSync(join(tmpdir(), 'task-access-')),
    resolveLegacy: async () => null,
  };
}
export function accessHeaders(
  method: string,
  id: string,
  body = '',
  ownerId = binding.ownerId,
  worker = binding.worker
): Record<string, string> {
  const path = method === 'POST' ? '/tasks' : '/tasks/' + encodeURIComponent(id);
  return {
    [TASK_ACCESS_HEADER]: signTaskAccess(privateKey, {
      ...binding,
      worker,
      ownerId,
      taskId: id,
      method,
      path,
      body,
    }),
  };
}
export function dispatchProof(payload: object, body: string): Record<string, string> {
  return 'taskId' in payload && typeof payload.taskId === 'string'
    ? accessHeaders('POST', payload.taskId, body)
    : {};
}
