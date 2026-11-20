import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sameTaskBinding, signTaskAccess, taskAudience, verifyTaskAccess } from '../taskAccess.js';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const request = {
  ownerId: 'owner-a',
  worker: 'worker-a',
  audience: 'https://worker.example',
  taskId: 'task-a',
  method: 'DELETE',
  path: '/tasks/task-a',
  body: '',
} as const;

describe('task access proofs', () => {
  it('pins the complete worker base URL and rejects ambiguous URLs', () => {
    expect(taskAudience('https://WORKER.example/path/')).toBe('https://worker.example/path');
    for (const bad of [
      'invalid',
      'file:///tmp/test',
      'https://user@worker.example',
      'https://worker.example/?query',
      'https://worker.example/#hash',
    ]) {
      expect(() => taskAudience(bad)).toThrow('Invalid task worker URL');
    }
  });
  it('rejects missing or changed owner/worker identities and non-Ed25519 credentials', () => {
    expect(sameTaskBinding(request, undefined)).toBe(false);
    expect(sameTaskBinding(request, { ...request, audience: 'other' })).toBe(false);
    expect(() => signTaskAccess(publicKey, request)).toThrow('signing identity');
    expect(() => signTaskAccess(privateKey, { ...request, ownerId: '' })).toThrow(
      'signing identity'
    );
    expect(() => signTaskAccess(privateKey, { ...request, worker: '' })).toThrow(
      'signing identity'
    );
    expect(verifyTaskAccess(privateKey, 'invalid', request)).toBeNull();
  });
  it.each(['null', '7', '{'])('rejects a signed invalid claims payload %s', (value) => {
    const payload = Buffer.from(value).toString('base64url');
    const signature = sign(null, Buffer.from(payload), privateKey).toString('base64url');
    expect(verifyTaskAccess(publicKey, payload + '.' + signature, request)).toBeNull();
  });

  it('binds a short-lived proof to its operation, body, audience and task', () => {
    const proof = signTaskAccess(privateKey, request, 1000);
    expect(verifyTaskAccess(publicKey, proof, request, 1000)).toMatchObject({ ownerId: 'owner-a' });
    for (const change of [
      { method: 'GET' },
      { path: '/tasks/task-b' },
      { taskId: 'task-b' },
      { audience: 'https://different.example' },
      { body: 'changed' },
    ]) {
      expect(verifyTaskAccess(publicKey, proof, { ...request, ...change }, 1000)).toBeNull();
    }
    expect(verifyTaskAccess(publicKey, proof, request, 999)).toBeNull();
    expect(verifyTaskAccess(publicKey, proof, request, 31_000)).toBeNull();
    expect(
      verifyTaskAccess(generateKeyPairSync('ed25519').publicKey, proof, request, 1000)
    ).toBeNull();
    expect(verifyTaskAccess(publicKey, 'invalid', request, 1000)).toBeNull();
  });
});
