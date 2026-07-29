import { describe, expect, it, vi } from 'vitest';
import type { MessageDigestErasureRequest } from '../models/messageDigestErasure.js';
import type { MessageDigestStore } from '../ports/messageDigestStore.js';
import {
  eraseMessageDigest,
  getMessageDigestErasure,
  resumeMessageDigestErasure,
} from './eraseMessageDigest.js';

const NOW = '2026-07-27T12:00:00.000Z';

describe('eraseMessageDigest', () => {
  it('starts one bounded batch and returns an explicit resume action', async () => {
    const startOrResumeDefinitionErasure = vi.fn<
      Pick<MessageDigestStore, 'startOrResumeDefinitionErasure'>['startOrResumeDefinitionErasure']
    >(async (input) => ({
      ok: true,
      status: 'in_progress',
      deletedThisCall: 25,
      request: request({
        erasureRequestId: input.erasureRequestId,
        requestIdDigest: input.requestIdDigest,
      }),
    }));

    const result = await eraseMessageDigest(
      {
        userId: 'synthetic-user-001',
        definitionId: 'md_definition_001',
        requestId: 'client-delete-request-001',
      },
      { store: { startOrResumeDefinitionErasure }, now: () => NOW }
    );

    expect(result).toMatchObject({
      ok: true,
      status: 'in_progress',
      deletedThisCall: 25,
      nextAction: 'resume_delete',
      erasureRequestId: expect.stringMatching(/^mde_[A-Za-z0-9_-]+$/u),
    });
    expect(startOrResumeDefinitionErasure).toHaveBeenCalledWith({
      userId: 'synthetic-user-001',
      definitionId: 'md_definition_001',
      erasureRequestId: expect.stringMatching(/^mde_[A-Za-z0-9_-]+$/u),
      requestIdDigest: expect.stringMatching(/^[0-9a-f]{64}$/u),
      now: NOW,
      limit: 50,
    });
  });

  it('returns a terminal recovery shape and maps owner-safe conflicts', async () => {
    const completedRequest = request({
      stage: 'completed',
      completedAt: NOW,
      expiresAt: 1_777_000_000,
    });
    const complete = vi.fn<
      Pick<MessageDigestStore, 'startOrResumeDefinitionErasure'>['startOrResumeDefinitionErasure']
    >(async () => ({
      ok: true,
      status: 'completed',
      deletedThisCall: 0,
      request: completedRequest,
    }));
    await expect(
      eraseMessageDigest(
        {
          userId: 'synthetic-user-001',
          definitionId: 'md_definition_001',
          requestId: 'client-delete-request-001',
        },
        { store: { startOrResumeDefinitionErasure: complete }, now: () => NOW }
      )
    ).resolves.toMatchObject({ ok: true, status: 'completed', nextAction: null });

    const missing = vi.fn<
      Pick<MessageDigestStore, 'startOrResumeDefinitionErasure'>['startOrResumeDefinitionErasure']
    >(async () => ({ ok: false, code: 'NOT_FOUND' }));
    await expect(
      eraseMessageDigest(
        {
          userId: 'synthetic-user-foreign',
          definitionId: 'md_definition_001',
          requestId: 'client-delete-request-002',
        },
        { store: { startOrResumeDefinitionErasure: missing }, now: () => NOW }
      )
    ).resolves.toEqual({ ok: false, code: 'NOT_FOUND' });
  });

  it('reads recovery state without advancing deletion', async () => {
    const getOwnedErasureRequest = vi.fn<
      Pick<MessageDigestStore, 'getOwnedErasureRequest'>['getOwnedErasureRequest']
    >(async () => request());

    await expect(
      getMessageDigestErasure(
        { userId: 'synthetic-user-001', erasureRequestId: 'mde_request_001' },
        { store: { getOwnedErasureRequest } }
      )
    ).resolves.toMatchObject({
      ok: true,
      status: 'in_progress',
      nextAction: 'resume_delete',
      deletedCounts: { runs: 2 },
    });
    expect(getOwnedErasureRequest).toHaveBeenCalledOnce();
  });

  it('resumes an existing owner-scoped erasure from its stored identity without a raw request key', async () => {
    const existing = request();
    const getOwnedErasureRequest = vi.fn<MessageDigestStore['getOwnedErasureRequest']>(
      async () => existing
    );
    const startOrResumeDefinitionErasure = vi.fn<
      MessageDigestStore['startOrResumeDefinitionErasure']
    >(async () => ({
      ok: true,
      status: 'in_progress',
      deletedThisCall: 2,
      request: { ...existing, stage: 'outbox', deletedCounts: { ...existing.deletedCounts, outbox: 2 } },
    }));

    await expect(
      resumeMessageDigestErasure(
        { userId: 'synthetic-user-001', erasureRequestId: 'mde_request_001' },
        {
          store: { getOwnedErasureRequest, startOrResumeDefinitionErasure },
          now: () => NOW,
        }
      )
    ).resolves.toMatchObject({
      ok: true,
      erasureRequestId: 'mde_request_001',
      definitionId: 'md_definition_001',
      nextAction: 'resume_delete',
    });
    expect(startOrResumeDefinitionErasure).toHaveBeenCalledWith({
      userId: 'synthetic-user-001',
      definitionId: existing.definitionId,
      erasureRequestId: existing.erasureRequestId,
      requestIdDigest: existing.requestIdDigest,
      now: NOW,
      limit: 50,
    });
  });

  it('returns owner-safe not found without mutation when resume cannot read the erasure', async () => {
    const getOwnedErasureRequest = vi.fn<MessageDigestStore['getOwnedErasureRequest']>(
      async () => null
    );
    const startOrResumeDefinitionErasure = vi.fn<
      MessageDigestStore['startOrResumeDefinitionErasure']
    >();

    await expect(
      resumeMessageDigestErasure(
        { userId: 'synthetic-user-foreign', erasureRequestId: 'mde_request_001' },
        {
          store: { getOwnedErasureRequest, startOrResumeDefinitionErasure },
          now: () => NOW,
        }
      )
    ).resolves.toEqual({ ok: false, code: 'NOT_FOUND' });
    expect(startOrResumeDefinitionErasure).not.toHaveBeenCalled();
  });

  it('validates resume boundaries before mutation and preserves a storage conflict', async () => {
    const getOwnedErasureRequest = vi.fn<MessageDigestStore['getOwnedErasureRequest']>(
      async () => request()
    );
    const startOrResumeDefinitionErasure = vi.fn<
      MessageDigestStore['startOrResumeDefinitionErasure']
    >(async () => ({ ok: false, code: 'ERASURE_CONFLICT' }));
    const dependencies = {
      store: { getOwnedErasureRequest, startOrResumeDefinitionErasure },
      now: (): string => NOW,
    };

    await expect(
      resumeMessageDigestErasure(
        { userId: ' ', erasureRequestId: 'mde_request_001' },
        dependencies
      )
    ).resolves.toEqual({ ok: false, code: 'NOT_FOUND' });
    await expect(
      resumeMessageDigestErasure(
        { userId: 'synthetic-user-001', erasureRequestId: 'mde_request_001', limit: 0 },
        dependencies
      )
    ).resolves.toEqual({ ok: false, code: 'INVALID_REQUEST' });
    expect(getOwnedErasureRequest).not.toHaveBeenCalled();

    await expect(
      resumeMessageDigestErasure(
        { userId: 'synthetic-user-001', erasureRequestId: 'mde_request_001' },
        dependencies
      )
    ).resolves.toEqual({ ok: false, code: 'ERASURE_CONFLICT' });
    expect(getOwnedErasureRequest).toHaveBeenCalledOnce();
    expect(startOrResumeDefinitionErasure).toHaveBeenCalledOnce();
  });

  it('rejects every invalid deletion boundary before touching storage', async () => {
    const valid = {
      userId: 'synthetic-user-001',
      definitionId: 'md_definition_001',
      requestId: 'client-delete-request-001',
    };
    const invalid = [
      { ...valid, userId: ' ' },
      { ...valid, definitionId: ' ' },
      { ...valid, requestId: 'short' },
      { ...valid, requestId: 'x'.repeat(257) },
      { ...valid, limit: 1.5 },
      { ...valid, limit: 0 },
      { ...valid, limit: 101 },
    ];
    for (const input of invalid) {
      const startOrResumeDefinitionErasure = vi.fn<
        MessageDigestStore['startOrResumeDefinitionErasure']
      >();
      await expect(
        eraseMessageDigest(
          input,
          { store: { startOrResumeDefinitionErasure }, now: () => NOW }
        )
      ).resolves.toEqual({ ok: false, code: 'INVALID_REQUEST' });
      expect(startOrResumeDefinitionErasure).not.toHaveBeenCalled();
    }

    const startOrResumeDefinitionErasure = vi.fn<
      MessageDigestStore['startOrResumeDefinitionErasure']
    >();
    await expect(
      eraseMessageDigest(valid, {
        store: { startOrResumeDefinitionErasure },
        now: () => 'not-an-instant',
      })
    ).resolves.toEqual({ ok: false, code: 'INVALID_REQUEST' });
  });

  it('returns not found for invalid, missing, and foreign recovery identifiers', async () => {
    const getOwnedErasureRequest = vi.fn<MessageDigestStore['getOwnedErasureRequest']>(
      async () => null
    );
    await expect(
      getMessageDigestErasure(
        { userId: ' ', erasureRequestId: 'mde_request_001' },
        { store: { getOwnedErasureRequest } }
      )
    ).resolves.toEqual({ ok: false, code: 'NOT_FOUND' });
    await expect(
      getMessageDigestErasure(
        { userId: 'synthetic-user-001', erasureRequestId: ' ' },
        { store: { getOwnedErasureRequest } }
      )
    ).resolves.toEqual({ ok: false, code: 'NOT_FOUND' });
    await expect(
      getMessageDigestErasure(
        { userId: 'synthetic-user-001', erasureRequestId: 'mde_missing_001' },
        { store: { getOwnedErasureRequest } }
      )
    ).resolves.toEqual({ ok: false, code: 'NOT_FOUND' });
  });
});

function request(
  overrides: Partial<MessageDigestErasureRequest> = {}
): MessageDigestErasureRequest {
  return {
    version: 1,
    erasureRequestId: 'mde_request_001',
    requestIdDigest: 'c'.repeat(64),
    userId: 'synthetic-user-001',
    definitionId: 'md_definition_001',
    erasureEpoch: 1,
    stage: 'runs',
    cursor: null,
    deletedCounts: { runs: 2, outbox: 0, state: 0, definition: 0, legacy: 0 },
    createdAt: NOW,
    updatedAt: NOW,
    completedAt: null,
    expiresAt: null,
    ...overrides,
  };
}
