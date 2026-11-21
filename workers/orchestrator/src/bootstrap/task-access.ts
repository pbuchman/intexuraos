import { createPublicKey } from 'node:crypto';
import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { taskAudience } from '@intexuraos/code-task-domain/task-access';
import { fetchDispatchMetadata } from '../services/dispatch-metadata-client.js';
import type { TaskAccessConfig } from '../services/task-access.js';
import type { BootstrapEnvConfig } from './env-config.js';

export function configureTaskAccess(
  env: BootstrapEnvConfig,
  stateDir: string
): TaskAccessConfig | undefined {
  const { taskAccessPublicKeyPath, taskAccessAudience } = env;
  if (taskAccessPublicKeyPath === undefined && taskAccessAudience === undefined) return undefined;
  if (taskAccessPublicKeyPath === undefined || taskAccessAudience === undefined) {
    throw new Error('Task access needs both a pinned public key and a worker audience');
  }
  const directory = lstatSync(dirname(taskAccessPublicKeyPath));
  if (
    !directory.isDirectory() ||
    (directory.mode & 0o022) !== 0 ||
    (directory.uid !== 0 && directory.uid !== process.getuid?.())
  )
    throw new Error('Unsafe task verification key directory');
  const fd = openSync(taskAccessPublicKeyPath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (
      !stat.isFile() ||
      (stat.mode & 0o022) !== 0 ||
      (stat.uid !== 0 && stat.uid !== process.getuid?.())
    )
      throw new Error('Unsafe task verification key permissions');
    const pem = readFileSync(fd, 'utf8');
    if (!pem.startsWith('-----BEGIN PUBLIC KEY-----'))
      throw new Error('Expected a public SPKI verification key');
    const key = createPublicKey(pem);
    if (key.asymmetricKeyType !== 'ed25519')
      throw new Error('Expected an Ed25519 verification key');
    return {
      key,
      audience: taskAudience(taskAccessAudience),
      nonceDir: join(stateDir, 'task-access-nonces'),
      resolveLegacy: (taskId) =>
        fetchDispatchMetadata(
          {
            codeAgentUrl: env.codeAgentUrl,
            internalAuthToken: env.internalAuthToken,
          },
          taskId
        ),
    };
  } finally {
    closeSync(fd);
  }
}
