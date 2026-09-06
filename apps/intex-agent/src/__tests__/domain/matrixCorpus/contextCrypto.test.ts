import { describe, expect, it } from 'vitest';

import {
  MatrixCorpusContextCryptoError,
  createMatrixCorpusContextCrypto,
  type MatrixCorpusContextCrypto,
  type MatrixCorpusContextEncryptionBindingV1,
} from '../../../domain/matrixCorpus/contextCrypto.js';

const key = Buffer.alloc(32, 7);
const nonce = Buffer.alloc(12, 3);
type RunBinding = Extract<
  MatrixCorpusContextEncryptionBindingV1,
  { kind: 'run_prompt_context' }
>;

function runBinding(
  overrides: Partial<RunBinding> = {}
): RunBinding {
  return {
    version: 1,
    kind: 'run_prompt_context',
    runtimeAudience: 'hetzner-prod',
    runId: 'run_1',
    userId: 'user_1',
    leaseFence: '7',
    ...overrides,
  };
}

function contextCrypto(
  overrides: { key?: Uint8Array; keyVersion?: string } = {}
): MatrixCorpusContextCrypto {
  return createMatrixCorpusContextCrypto({
    key: overrides.key ?? key,
    keyVersion: overrides.keyVersion ?? 'context-key-v1',
    randomBytes: (size) => {
      expect(size).toBe(12);
      return nonce;
    },
  });
}

describe('Matrix corpus context crypto', () => {
  it('encrypts and decrypts UTF-8 prompt context with AES-256-GCM', () => {
    const crypto = contextCrypto();
    const plaintext = 'Poufny kontekst użytkownika: łowię tylko szczupaki.';

    const encrypted = crypto.encrypt(plaintext, runBinding());

    expect(encrypted).toEqual({
      algorithm: 'aes-256-gcm',
      keyVersion: 'context-key-v1',
      nonce: nonce.toString('base64url'),
      ciphertext: expect.any(String),
      authenticationTag: expect.any(String),
    });
    expect(JSON.stringify(encrypted)).not.toContain(plaintext);
    expect(crypto.decrypt(encrypted, runBinding())).toBe(plaintext);
  });

  it('round-trips an empty prompt context using canonical empty ciphertext', () => {
    const crypto = contextCrypto();
    const encrypted = crypto.encrypt('', runBinding());

    expect(encrypted.ciphertext).toBe('');
    expect(crypto.decrypt(encrypted, runBinding())).toBe('');
  });

  it.each([
    ['run', { runId: 'run_2' }],
    ['user', { userId: 'user_2' }],
    ['fence', { leaseFence: '8' }],
  ])('authenticates the complete %s binding', (_name, changedBinding) => {
    const crypto = contextCrypto();
    const encrypted = crypto.encrypt('private', runBinding());

    expect(() => crypto.decrypt(encrypted, runBinding(changedBinding))).toThrowError(
      new MatrixCorpusContextCryptoError('AUTHENTICATION_FAILED')
    );
  });

  it('authenticates the scenario id for scenario prompt context', () => {
    const crypto = contextCrypto();
    const binding: MatrixCorpusContextEncryptionBindingV1 = {
      version: 1,
      kind: 'scenario_prompt_context',
      runtimeAudience: 'hetzner-prod',
      runId: 'run_1',
      userId: 'user_1',
      leaseFence: '7',
      scenarioId: 'scenario_1',
    };
    const encrypted = crypto.encrypt('private', binding);

    expect(() =>
      crypto.decrypt(encrypted, { ...binding, scenarioId: 'scenario_2' })
    ).toThrowError(new MatrixCorpusContextCryptoError('AUTHENTICATION_FAILED'));
  });

  it('domain-separates and authenticates every test-confirmation identity field', () => {
    const crypto = contextCrypto();
    const binding: MatrixCorpusContextEncryptionBindingV1 = {
      version: 1,
      kind: 'test_confirmation_tool_args',
      runtimeAudience: 'hetzner-prod',
      confirmationId: 'confirmation_1',
      runId: 'run_1',
      scenarioId: 'scenario_1',
      sessionId: 'session_1',
      userId: 'user_1',
      leaseFence: '7',
      toolName: 'create_note',
      selectionTurnIndex: 0,
      selectionOrdinal: 1,
      createdAt: '2026-07-20T10:00:00.000Z',
      expiresAt: '2026-07-20T10:05:00.000Z',
      state: 'pending',
      decision: null,
      resolutionMessageId: null,
      resolvedAt: null,
    };
    const encrypted = crypto.encrypt('{"content":"private"}', binding);

    for (const changedBinding of [
      { ...binding, confirmationId: 'confirmation_2' },
      { ...binding, runId: 'run_2' },
      { ...binding, scenarioId: 'scenario_2' },
      { ...binding, sessionId: 'session_2' },
      { ...binding, userId: 'user_2' },
      { ...binding, leaseFence: '8' },
      { ...binding, toolName: 'create_calendar_event' },
      { ...binding, selectionTurnIndex: 1 },
      { ...binding, selectionOrdinal: 2 },
      { ...binding, createdAt: '2026-07-20T10:01:00.000Z' },
      { ...binding, expiresAt: '2026-07-20T10:04:00.000Z' },
    ]) {
      expect(() => crypto.decrypt(encrypted, changedBinding)).toThrowError(
        new MatrixCorpusContextCryptoError('AUTHENTICATION_FAILED')
      );
    }

    const resolvedBinding = {
      ...binding,
      state: 'resolved' as const,
      decision: 'confirm' as const,
      resolutionMessageId: 'transport_confirmation_1',
      resolvedAt: '2026-07-20T10:01:00.000Z',
    };
    const resolvedEncrypted = crypto.encrypt('{"content":"private"}', resolvedBinding);
    for (const changedBinding of [
      { ...resolvedBinding, decision: 'reject' as const },
      { ...resolvedBinding, resolutionMessageId: 'transport_confirmation_2' },
      { ...resolvedBinding, resolvedAt: '2026-07-20T10:01:00.001Z' },
    ]) {
      expect(() => crypto.decrypt(resolvedEncrypted, changedBinding)).toThrowError(
        new MatrixCorpusContextCryptoError('AUTHENTICATION_FAILED')
      );
    }

    expect(() =>
      crypto.decrypt(resolvedEncrypted, {
        ...resolvedBinding,
        state: 'pending',
      })
    ).toThrowError(new MatrixCorpusContextCryptoError('INVALID_BINDING'));
  });

  it.each(['nonce', 'ciphertext', 'authenticationTag'] as const)(
    'rejects tampered %s without returning plaintext',
    (field) => {
      const crypto = contextCrypto();
      const encrypted = crypto.encrypt('private', runBinding());
      const tampered = { ...encrypted, [field]: `${encrypted[field]}A` };

      expect(() => crypto.decrypt(tampered, runBinding())).toThrowError(
        MatrixCorpusContextCryptoError
      );
    }
  );

  it('rejects the wrong key version before decryption', () => {
    const encrypted = contextCrypto().encrypt('private', runBinding());

    expect(() =>
      contextCrypto({ keyVersion: 'context-key-v2' }).decrypt(encrypted, runBinding())
    ).toThrowError(new MatrixCorpusContextCryptoError('UNKNOWN_KEY_VERSION'));
  });

  it('rejects the wrong key and malformed encrypted values with static errors', () => {
    const encrypted = contextCrypto().encrypt('private', runBinding());

    expect(() =>
      contextCrypto({ key: Buffer.alloc(32, 8) }).decrypt(encrypted, runBinding())
    ).toThrowError(new MatrixCorpusContextCryptoError('AUTHENTICATION_FAILED'));
    expect(() =>
      contextCrypto().decrypt({ ...encrypted, nonce: 'not base64url!' }, runBinding())
    ).toThrowError(new MatrixCorpusContextCryptoError('INVALID_ENCRYPTED_VALUE'));
  });

  it('rejects invalid keys, key versions, bindings, nonce sources, and oversized plaintext', () => {
    expect(() => contextCrypto({ key: Buffer.alloc(31) })).toThrowError(
      new MatrixCorpusContextCryptoError('INVALID_KEY_CONFIGURATION')
    );
    expect(() => contextCrypto({ keyVersion: 'bad version' })).toThrowError(
      new MatrixCorpusContextCryptoError('INVALID_KEY_CONFIGURATION')
    );
    expect(() => contextCrypto().encrypt('private', runBinding({ runId: '' }))).toThrowError(
      new MatrixCorpusContextCryptoError('INVALID_BINDING')
    );
    expect(() =>
      contextCrypto().decrypt(
        contextCrypto().encrypt('private', runBinding()),
        runBinding({ runtimeAudience: 'prod' as never })
      )
    ).toThrowError(new MatrixCorpusContextCryptoError('INVALID_BINDING'));
    expect(() =>
      createMatrixCorpusContextCrypto({
        key,
        keyVersion: 'context-key-v1',
        randomBytes: () => Buffer.alloc(11),
      }).encrypt('private', runBinding())
    ).toThrowError(new MatrixCorpusContextCryptoError('INVALID_NONCE'));
    expect(() => contextCrypto().encrypt('x'.repeat(262_145), runBinding())).toThrowError(
      new MatrixCorpusContextCryptoError('PLAINTEXT_TOO_LARGE')
    );
  });
});
