import { createHash, randomUUID, sign, verify, type KeyObject } from 'node:crypto';

export const TASK_ACCESS_HEADER = 'x-task-access-proof';
export const TASK_ACCESS_TTL_MS = 30_000;
const DOMAIN = 'intexuraos.task-access.v1';

export interface TaskBinding {
  ownerId: string;
  worker: string;
  audience: string;
}

interface Operation {
  method: string;
  path: string;
  taskId: string;
  body: string;
}

export interface TaskAccessClaims extends TaskBinding {
  nonce: string;
  issued: number;
}

/** A path-prefixed reverse proxy can serve more than one worker at an origin. */
export function taskAudience(workerUrl: string): string {
  if (!URL.canParse(workerUrl)) throw new Error('Invalid task worker URL');
  const url = new URL(workerUrl);
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error('Invalid task worker URL');
  }
  return url.href.replace(/\/+$/u, '');
}

export function sameTaskBinding(left: TaskBinding, right: TaskBinding | undefined): boolean {
  return (
    right?.ownerId === left.ownerId &&
    left.worker === right.worker &&
    left.audience === right.audience
  );
}

function bodyDigest(body: string): string {
  return createHash('sha256').update(body).digest('hex');
}

export function signTaskAccess(
  key: KeyObject,
  request: Operation & TaskBinding,
  issued = Date.now()
): string {
  if (
    key.type !== 'private' ||
    key.asymmetricKeyType !== 'ed25519' ||
    !request.ownerId ||
    !request.worker
  ) {
    throw new Error('Task signing identity unavailable');
  }
  const payload = Buffer.from(
    JSON.stringify({
      issuer: DOMAIN,
      taskId: request.taskId,
      ownerId: request.ownerId,
      worker: request.worker,
      audience: request.audience,
      method: request.method,
      path: request.path,
      digest: bodyDigest(request.body),
      issued,
      nonce: randomUUID(),
    })
  ).toString('base64url');
  return payload + '.' + sign(null, Buffer.from(payload), key).toString('base64url');
}

export function verifyTaskAccess(
  key: KeyObject,
  proof: string,
  request: Operation & { audience: string },
  now = Date.now()
): TaskAccessClaims | null {
  if (key.type !== 'public' || key.asymmetricKeyType !== 'ed25519' || proof.length > 8192)
    return null;
  const parts = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{86})$/u.exec(proof);
  const [, payload, encodedSignature] = parts ?? [];
  if (payload === undefined || encodedSignature === undefined) return null;
  const signature = Buffer.from(encodedSignature, 'base64url');
  if (!verify(null, Buffer.from(payload), key, signature)) return null;
  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof claims !== 'object' || claims === null) return null;
  const c = claims as Record<string, unknown>;
  if (
    c['issuer'] !== DOMAIN ||
    c['taskId'] !== request.taskId ||
    c['method'] !== request.method ||
    c['audience'] !== request.audience ||
    c['path'] !== request.path ||
    c['digest'] !== bodyDigest(request.body) ||
    typeof c['issued'] !== 'number' ||
    !Number.isSafeInteger(c['issued']) ||
    now < c['issued'] ||
    now - c['issued'] >= TASK_ACCESS_TTL_MS ||
    typeof c['nonce'] !== 'string' ||
    !/^[a-f0-9-]{36}$/u.test(c['nonce']) ||
    typeof c['ownerId'] !== 'string' ||
    !c['ownerId'] ||
    typeof c['worker'] !== 'string' ||
    !c['worker']
  )
    return null;
  return {
    ownerId: c['ownerId'],
    worker: c['worker'],
    audience: request.audience,
    nonce: c['nonce'],
    issued: c['issued'],
  };
}
