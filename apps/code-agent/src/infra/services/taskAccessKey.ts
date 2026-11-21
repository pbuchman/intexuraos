import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { userInfo } from 'node:os';
import { privateCredentialMode } from './systemdTaskCredential.js';
import { z } from 'zod';
import { taskAudience, type TaskBinding } from '@intexuraos/code-task-domain/task-access';
import { createPrivateKey, type KeyObject } from 'node:crypto';

/** A read-only application-owned PKCS#8 mount. Never place its value in service environment. */
function readProtectedFile(path: string): Buffer {
  const directory = lstatSync(dirname(path));
  if (!directory.isDirectory() || !privateCredentialMode(dirname(path), directory, true)) {
    throw new Error('Unsafe task signing mount directory');
  }
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || !privateCredentialMode(path, stat, false)) throw new Error('Unsafe task signing key permissions');
    return readFileSync(fd);
  } finally {
    closeSync(fd);
  }
}

export function loadTaskAccessKey(path: string | undefined): KeyObject | undefined {
  if (path === undefined) return undefined;
  if (userInfo().username === 'intexuraos-prod') throw new Error('Shared Home PROD account cannot sign task access');
  const key = createPrivateKey(readProtectedFile(path));
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('Expected an Ed25519 task signing key');
  return key;
}

const legacyBindings = z.array(z.object({
  ownerId: z.string().min(1), worker: z.string().min(1), audience: z.string().min(1),
}).strict());

/** The operator may corroborate historical worker destinations alongside the app-owned key. */
export function loadLegacyTaskBindings(keyPath: string | undefined): TaskBinding[] {
  if (keyPath === undefined) return [];
  let input: Buffer;
  try {
    input = readProtectedFile(join(dirname(keyPath), 'legacy-worker-bindings.json'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  let bindings: TaskBinding[];
  try {
    bindings = legacyBindings.parse(JSON.parse(input.toString('utf8')));
  } catch {
    throw new Error('Invalid historical worker binding configuration');
  }
  const seen = new Set<string>();
  for (const binding of bindings) {
    const id = JSON.stringify([binding.ownerId, binding.worker]);
    if (seen.has(id)) throw new Error('Ambiguous historical worker binding');
    seen.add(id);
    binding.audience = taskAudience(binding.audience);
  }
  return bindings;
}
