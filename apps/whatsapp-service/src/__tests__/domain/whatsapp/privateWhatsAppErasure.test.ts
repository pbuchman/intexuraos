import { describe, expect, it, vi } from 'vitest';
import { err, ok } from '@intexuraos/common-core';
import {
  emptyPrivateWhatsAppErasureCounts,
  type PrivateWhatsAppErasureRequest,
} from '../../../domain/whatsapp/models/PrivateWhatsAppErasure.js';
import type {
  PrivateWhatsAppErasurePublisher,
  PrivateWhatsAppErasureRepository,
} from '../../../domain/whatsapp/ports/privateWhatsAppErasure.js';
import type {
  MediaStoragePort,
  PrivateMediaDeletionBatchResult,
} from '../../../domain/whatsapp/ports/mediaStorage.js';
import {
  processPrivateWhatsAppErasureBatch,
  requestPrivateWhatsAppErasure,
  type PrivateWhatsAppErasureDeps,
} from '../../../domain/whatsapp/usecases/privateWhatsAppErasure.js';
import type { ConversationAssistantOperationalTelemetry } from '../../../domain/conversation-assistant/operationalTelemetry.js';

const baseRequest = {
  erasureRequestId: 'erase-1',
  userId: 'user-1',
  sourceAccountId: 'source-1',
  accountGeneration: '2026-07-21T10:00:00.000Z',
  status: 'queued' as const,
  stage: 'assistant_sessions' as const,
  counts: emptyPrivateWhatsAppErasureCounts(),
  attempt: 0,
  createdAt: '2026-07-21T11:00:00.000Z',
  updatedAt: '2026-07-21T11:00:00.000Z',
};

function deps(overrides: {
  repository?: Partial<PrivateWhatsAppErasureRepository>;
  publisher?: Partial<PrivateWhatsAppErasurePublisher>;
  mediaStorage?: Partial<Pick<MediaStoragePort, 'deletePrivateMediaBatch'>>;
  telemetry?: ConversationAssistantOperationalTelemetry;
} = {}): PrivateWhatsAppErasureDeps & {
  mediaStorage: Pick<MediaStoragePort, 'deletePrivateMediaBatch'>;
} {
  const repository: PrivateWhatsAppErasureRepository = {
    start: vi.fn().mockResolvedValue(ok({ status: 'created', request: baseRequest })),
    get: vi.fn().mockResolvedValue(ok(baseRequest)),
    advanceOneBatch: vi.fn().mockResolvedValue(
      ok({
        status: 'advanced',
        request: { ...baseRequest, status: 'running', attempt: 1 },
      })
    ),
    commitPrivateMediaBatch: vi.fn().mockResolvedValue(
      ok({
        status: 'advanced',
        request: { ...baseRequest, status: 'running', attempt: 1 },
      })
    ),
    ...overrides.repository,
  };
  const publisher: PrivateWhatsAppErasurePublisher = {
    publishPrivateWhatsAppErasure: vi.fn().mockResolvedValue(ok(undefined)),
    ...overrides.publisher,
  };
  const mediaStorage: Pick<MediaStoragePort, 'deletePrivateMediaBatch'> = {
    deletePrivateMediaBatch: vi
      .fn()
      .mockResolvedValue(ok({ status: 'empty', deletedCount: 0 })),
    ...overrides.mediaStorage,
  };
  return {
    repository,
    publisher,
    mediaStorage,
    now: (): string => '2026-07-21T11:00:00.000Z',
    ...(overrides.telemetry === undefined ? {} : { telemetry: overrides.telemetry }),
  };
}

describe('private WhatsApp physical erasure workflow', () => {
  it('starts one durable generation-fenced request and publishes content-free work', async () => {
    const testDeps = deps();
    const result = await requestPrivateWhatsAppErasure(
      { sourceAccountId: 'source-1', userId: 'user-1', erasureRequestId: 'erase-1' },
      testDeps
    );

    expect(result).toEqual(ok({ status: 'accepted', request: baseRequest }));
    expect(testDeps.repository.start).toHaveBeenCalledWith({
      sourceAccountId: 'source-1',
      userId: 'user-1',
      erasureRequestId: 'erase-1',
      now: '2026-07-21T11:00:00.000Z',
    });
    expect(testDeps.publisher.publishPrivateWhatsAppErasure).toHaveBeenCalledWith({
      type: 'whatsapp.private-account.erasure',
      sourceAccountId: 'source-1',
      userId: 'user-1',
      erasureRequestId: 'erase-1',
      attempt: 0,
    });
  });

  it('re-publishes an identical incomplete request and never re-publishes completed work', async () => {
    const existing = deps({
      repository: {
        start: vi.fn().mockResolvedValue(ok({ status: 'existing', request: baseRequest })),
      },
    });
    expect(
      await requestPrivateWhatsAppErasure(
        { sourceAccountId: 'source-1', userId: 'user-1', erasureRequestId: 'erase-1' },
        existing
      )
    ).toEqual(ok({ status: 'accepted', request: baseRequest }));
    expect(existing.publisher.publishPrivateWhatsAppErasure).toHaveBeenCalledOnce();

    const completedRequest = {
      ...baseRequest,
      status: 'completed' as const,
      stage: 'completed' as const,
      completedAt: '2026-07-21T11:01:00.000Z',
    };
    const completed = deps({
      repository: {
        start: vi.fn().mockResolvedValue(
          ok({ status: 'existing', request: completedRequest })
        ),
      },
    });
    expect(
      await requestPrivateWhatsAppErasure(
        { sourceAccountId: 'source-1', userId: 'user-1', erasureRequestId: 'erase-1' },
        completed
      )
    ).toEqual(ok({ status: 'accepted', request: completedRequest }));
    expect(completed.publisher.publishPrivateWhatsAppErasure).not.toHaveBeenCalled();
  });

  it.each(['not_found', 'conflict'] as const)('returns %s without publishing', async (status) => {
    const testDeps = deps({
      repository: { start: vi.fn().mockResolvedValue(ok({ status })) },
    });
    expect(
      await requestPrivateWhatsAppErasure(
        { sourceAccountId: 'source-1', userId: 'user-1', erasureRequestId: 'erase-1' },
        testDeps
      )
    ).toEqual(ok({ status }));
    expect(testDeps.publisher.publishPrivateWhatsAppErasure).not.toHaveBeenCalled();
  });

  it('surfaces persistence and publish failures for safe HTTP/PubSub retry', async () => {
    const persistenceFailure = deps({
      repository: {
        start: vi.fn().mockResolvedValue(
          err({ code: 'PERSISTENCE_ERROR', message: 'failed' })
        ),
      },
    });
    expect(
      await requestPrivateWhatsAppErasure(
        { sourceAccountId: 'source-1', userId: 'user-1', erasureRequestId: 'erase-1' },
        persistenceFailure
      )
    ).toEqual(err({ code: 'PERSISTENCE_ERROR', message: 'failed' }));

    const publishFailure = deps({
      publisher: {
        publishPrivateWhatsAppErasure: vi.fn().mockResolvedValue(
          err({ code: 'INTERNAL_ERROR', message: 'publish failed' })
        ),
      },
    });
    expect(
      await requestPrivateWhatsAppErasure(
        { sourceAccountId: 'source-1', userId: 'user-1', erasureRequestId: 'erase-1' },
        publishFailure
      )
    ).toEqual(err({ code: 'INTERNAL_ERROR', message: 'publish failed' }));
  });

  it('advances exactly one bounded batch and publishes the next attempt', async () => {
    const testDeps = deps();
    const event = {
      type: 'whatsapp.private-account.erasure' as const,
      sourceAccountId: 'source-1',
      userId: 'user-1',
      erasureRequestId: 'erase-1',
      attempt: 0,
    };

    expect(await processPrivateWhatsAppErasureBatch(event, testDeps)).toEqual(
      ok({ status: 'advanced' })
    );
    expect(testDeps.repository.advanceOneBatch).toHaveBeenCalledWith({
      sourceAccountId: 'source-1',
      userId: 'user-1',
      erasureRequestId: 'erase-1',
      expectedAttempt: 0,
      batchSize: 20,
      now: '2026-07-21T11:00:00.000Z',
    });
    expect(testDeps.publisher.publishPrivateWhatsAppErasure).toHaveBeenCalledWith({
      ...event,
      attempt: 1,
    });
  });

  it.each([
    {
      name: 'complete page',
      batch: {
        status: 'advanced',
        deletedCount: 2,
        nextCursor: 'whatsapp/private/user-1/message-2/thumb.jpg',
      } satisfies PrivateMediaDeletionBatchResult,
    },
    {
      name: 'partial failure',
      batch: { status: 'retry', deletedCount: 1 } satisfies PrivateMediaDeletionBatchResult,
    },
    {
      name: 'zero-object verification',
      batch: { status: 'empty', deletedCount: 0 } satisfies PrivateMediaDeletionBatchResult,
    },
  ])('runs one bounded private-media $name and durably republishes progress', async ({ batch }) => {
    const privateMediaRequest = {
      ...baseRequest,
      status: 'running' as const,
      stage: 'private_media' as const,
    };
    const committedRequest = { ...privateMediaRequest, attempt: 1 };
    const testDeps = deps({
      repository: {
        advanceOneBatch: vi.fn().mockResolvedValue(
          ok({
            status: 'private_media',
            request: privateMediaRequest,
            cursor: 'whatsapp/private/user-1/message-1/original.jpg',
          })
        ),
        commitPrivateMediaBatch: vi.fn().mockResolvedValue(
          ok({ status: 'advanced', request: committedRequest })
        ),
      },
      mediaStorage: {
        deletePrivateMediaBatch: vi.fn().mockResolvedValue(ok(batch)),
      },
    });
    const event = {
      type: 'whatsapp.private-account.erasure' as const,
      sourceAccountId: 'source-1',
      userId: 'user-1',
      erasureRequestId: 'erase-1',
      attempt: 0,
    };

    expect(await processPrivateWhatsAppErasureBatch(event, testDeps)).toEqual(
      ok({ status: 'advanced' })
    );
    expect(testDeps.mediaStorage.deletePrivateMediaBatch).toHaveBeenCalledWith({
      userId: 'user-1',
      cursor: 'whatsapp/private/user-1/message-1/original.jpg',
      limit: 20,
    });
    expect(testDeps.repository.commitPrivateMediaBatch).toHaveBeenCalledWith({
      sourceAccountId: 'source-1',
      userId: 'user-1',
      erasureRequestId: 'erase-1',
      expectedAttempt: 0,
      expectedCursor: 'whatsapp/private/user-1/message-1/original.jpg',
      batch,
      now: '2026-07-21T11:00:00.000Z',
    });
    expect(testDeps.publisher.publishPrivateWhatsAppErasure).toHaveBeenCalledWith({
      ...event,
      attempt: 1,
    });
  });

  it('leaves the durable attempt unchanged when private-media listing fails for PubSub retry', async () => {
    const privateMediaRequest = {
      ...baseRequest,
      status: 'running' as const,
      stage: 'private_media' as const,
    };
    const testDeps = deps({
      repository: {
        advanceOneBatch: vi.fn().mockResolvedValue(
          ok({ status: 'private_media', request: privateMediaRequest })
        ),
      },
      mediaStorage: {
        deletePrivateMediaBatch: vi.fn().mockResolvedValue(
          err({
            code: 'PERSISTENCE_ERROR',
            message: 'Failed to list private media for erasure',
          })
        ),
      },
    });

    await expect(
      processPrivateWhatsAppErasureBatch(
        {
          type: 'whatsapp.private-account.erasure',
          sourceAccountId: 'source-1',
          userId: 'user-1',
          erasureRequestId: 'erase-1',
          attempt: 0,
        },
        testDeps
      )
    ).resolves.toEqual(
      err({
        code: 'PERSISTENCE_ERROR',
        message: 'Failed to list private media for erasure',
      })
    );
    expect(testDeps.repository.commitPrivateMediaBatch).not.toHaveBeenCalled();
    expect(testDeps.publisher.publishPrivateWhatsAppErasure).not.toHaveBeenCalled();
  });

  it('retries the work item when private-media progress cannot be committed', async () => {
    const privateMediaRequest = {
      ...baseRequest,
      status: 'running' as const,
      stage: 'private_media' as const,
    };
    const testDeps = deps({
      repository: {
        advanceOneBatch: vi.fn().mockResolvedValue(
          ok({ status: 'private_media', request: privateMediaRequest })
        ),
        commitPrivateMediaBatch: vi.fn().mockResolvedValue(
          err({ code: 'PERSISTENCE_ERROR', message: 'commit failed' })
        ),
      },
      mediaStorage: {
        deletePrivateMediaBatch: vi
          .fn()
          .mockResolvedValue(ok({ status: 'empty', deletedCount: 0 })),
      },
    });

    await expect(
      processPrivateWhatsAppErasureBatch(
        {
          type: 'whatsapp.private-account.erasure',
          sourceAccountId: 'source-1',
          userId: 'user-1',
          erasureRequestId: 'erase-1',
          attempt: 0,
        },
        testDeps
      )
    ).resolves.toEqual(err({ code: 'PERSISTENCE_ERROR', message: 'commit failed' }));
    expect(testDeps.publisher.publishPrivateWhatsAppErasure).not.toHaveBeenCalled();
  });

  it.each(['stale', 'not_found'] as const)('acks %s work without re-publishing', async (status) => {
    const testDeps = deps({
      repository: {
        advanceOneBatch: vi.fn().mockResolvedValue(ok({ status })),
        ...(status === 'stale' ? { get: vi.fn().mockResolvedValue(ok(null)) } : {}),
      },
    });
    expect(
      await processPrivateWhatsAppErasureBatch(
        {
          type: 'whatsapp.private-account.erasure',
          sourceAccountId: 'source-1',
          userId: 'user-1',
          erasureRequestId: 'erase-1',
          attempt: 0,
        },
        testDeps
      )
    ).toEqual(ok({ status }));
    expect(testDeps.publisher.publishPrivateWhatsAppErasure).not.toHaveBeenCalled();
  });

  it('acks completion without another event and retries publish/advance failures', async () => {
    const completedRequest = {
      ...baseRequest,
      status: 'completed' as const,
      stage: 'completed' as const,
      completedAt: '2026-07-21T11:01:00.000Z',
    };
    const completed = deps({
      repository: {
        advanceOneBatch: vi.fn().mockResolvedValue(
          ok({ status: 'completed', request: completedRequest })
        ),
      },
    });
    const event = {
      type: 'whatsapp.private-account.erasure' as const,
      sourceAccountId: 'source-1',
      userId: 'user-1',
      erasureRequestId: 'erase-1',
      attempt: 0,
    };
    expect(await processPrivateWhatsAppErasureBatch(event, completed)).toEqual(
      ok({ status: 'completed' })
    );
    expect(completed.publisher.publishPrivateWhatsAppErasure).not.toHaveBeenCalled();

    const advanceFailure = deps({
      repository: {
        advanceOneBatch: vi.fn().mockResolvedValue(
          err({ code: 'PERSISTENCE_ERROR', message: 'advance failed' })
        ),
      },
    });
    expect(await processPrivateWhatsAppErasureBatch(event, advanceFailure)).toEqual(
      err({ code: 'PERSISTENCE_ERROR', message: 'advance failed' })
    );

    const publishFailure = deps({
      publisher: {
        publishPrivateWhatsAppErasure: vi.fn().mockResolvedValue(
          err({ code: 'INTERNAL_ERROR', message: 'publish failed' })
        ),
      },
    });
    expect(await processPrivateWhatsAppErasureBatch(event, publishFailure)).toEqual(
      err({ code: 'INTERNAL_ERROR', message: 'publish failed' })
    );
  });

  it('acks a terminal generation-fence failure without publishing more work', async () => {
    const failedRequest = {
      ...baseRequest,
      status: 'failed' as const,
      failureCode: 'ACCOUNT_GENERATION_CHANGED' as const,
    };
    const testDeps = deps({
      repository: {
        advanceOneBatch: vi.fn().mockResolvedValue(
          ok({ status: 'failed', request: failedRequest })
        ),
      },
    });

    expect(
      await processPrivateWhatsAppErasureBatch(
        {
          type: 'whatsapp.private-account.erasure',
          sourceAccountId: 'source-1',
          userId: 'user-1',
          erasureRequestId: 'erase-1',
          attempt: 0,
        },
        testDeps
      )
    ).toEqual(ok({ status: 'failed' }));
    expect(testDeps.publisher.publishPrivateWhatsAppErasure).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: 'created',
      start: ok({ status: 'created' as const, request: baseRequest }),
      outcome: 'created',
    },
    {
      name: 'replay',
      start: ok({ status: 'existing' as const, request: baseRequest }),
      outcome: 'replay',
    },
    { name: 'conflict', start: ok({ status: 'conflict' as const }), outcome: 'conflict' },
  ])('records content-free $name request telemetry', async ({ start, outcome }) => {
    const telemetry = { record: vi.fn().mockResolvedValue(undefined) };
    const testDeps = deps({
      repository: { start: vi.fn().mockResolvedValue(start) },
      telemetry,
    });

    await requestPrivateWhatsAppErasure(
      { sourceAccountId: 'source-secret', userId: 'user-secret', erasureRequestId: 'erase-secret' },
      testDeps
    );

    expect(telemetry.record).toHaveBeenCalledWith({
      operation: 'privacy_erasure',
      outcome,
      durationMs: expect.any(Number),
      count: 0,
    });
    expect(JSON.stringify(telemetry.record.mock.calls)).not.toContain('secret');
  });

  it.each([
    {
      name: 'advanced',
      advance: ok({
        status: 'advanced' as const,
        request: {
          ...baseRequest,
          status: 'running' as const,
          attempt: 1,
          counts: { ...baseRequest.counts, sourceMessages: 4 },
        },
      }),
      outcome: 'partial',
      count: 4,
    },
    {
      name: 'completed',
      advance: ok({
        status: 'completed' as const,
        request: {
          ...baseRequest,
          status: 'completed' as const,
          stage: 'completed' as const,
          counts: { ...baseRequest.counts, sourceAccounts: 1 },
        },
      }),
      outcome: 'completed',
      count: 1,
    },
    {
      name: 'terminal failure',
      advance: ok({
        status: 'failed' as const,
        request: { ...baseRequest, status: 'failed' as const },
      }),
      outcome: 'failed',
      count: 0,
    },
    { name: 'stale', advance: ok({ status: 'stale' as const }), outcome: 'stale', count: 0 },
  ])('records content-free $name batch telemetry', async ({ advance, outcome, count }) => {
    const telemetry = { record: vi.fn().mockResolvedValue(undefined) };
    const testDeps = deps({
      repository: {
        advanceOneBatch: vi.fn().mockResolvedValue(advance),
        ...(advance.ok && advance.value.status === 'stale'
          ? { get: vi.fn().mockResolvedValue(ok(null)) }
          : {}),
      },
      telemetry,
    });

    await processPrivateWhatsAppErasureBatch(
      {
        type: 'whatsapp.private-account.erasure',
        sourceAccountId: 'source-secret',
        userId: 'user-secret',
        erasureRequestId: 'erase-secret',
        attempt: 0,
      },
      testDeps
    );

    expect(telemetry.record).toHaveBeenCalledWith({
      operation: 'privacy_erasure',
      outcome,
      durationMs: expect.any(Number),
      count,
    });
    expect(JSON.stringify(telemetry.record.mock.calls)).not.toContain('secret');
  });

  it('recovers a failed next-attempt publish from the stale delivery and reaches completion', async () => {
    let current: PrivateWhatsAppErasureRequest = baseRequest;
    let failNextPublish = true;
    const delivered: {
      type: 'whatsapp.private-account.erasure';
      sourceAccountId: string;
      userId: string;
      erasureRequestId: string;
      attempt: number;
    }[] = [];
    const telemetry = { record: vi.fn().mockResolvedValue(undefined) };
    const repository: PrivateWhatsAppErasureRepository = {
      start: vi.fn(),
      get: vi.fn().mockImplementation(() => Promise.resolve(ok(current))),
      advanceOneBatch: vi.fn().mockImplementation((input: { expectedAttempt: number }) => {
        if (input.expectedAttempt !== current.attempt) {
          return Promise.resolve(ok({ status: 'stale' as const }));
        }
        if (current.attempt === 0) {
          current = {
            ...current,
            status: 'running',
            stage: 'source_messages',
            attempt: 1,
            counts: { ...current.counts, sourceMessages: 1 },
          };
          return Promise.resolve(ok({ status: 'advanced' as const, request: current }));
        }
        current = {
          ...current,
          status: 'completed',
          stage: 'completed',
          attempt: 2,
          completedAt: '2026-07-21T11:02:00.000Z',
        };
        return Promise.resolve(ok({ status: 'completed' as const, request: current }));
      }),
      commitPrivateMediaBatch: vi.fn(),
    };
    const publisher: PrivateWhatsAppErasurePublisher = {
      publishPrivateWhatsAppErasure: vi.fn().mockImplementation((event) => {
        if (failNextPublish) {
          failNextPublish = false;
          return Promise.resolve(err({ code: 'INTERNAL_ERROR', message: 'publish failed' }));
        }
        delivered.push(event);
        return Promise.resolve(ok(undefined));
      }),
    };
    const testDeps: PrivateWhatsAppErasureDeps = {
      repository,
      publisher,
      mediaStorage: {
        deletePrivateMediaBatch: vi
          .fn()
          .mockResolvedValue(ok({ status: 'empty', deletedCount: 0 })),
      },
      telemetry,
      now: () => '2026-07-21T11:00:00.000Z',
    };
    const firstEvent = {
      type: 'whatsapp.private-account.erasure' as const,
      sourceAccountId: 'source-1',
      userId: 'user-1',
      erasureRequestId: 'erase-1',
      attempt: 0,
    };

    await expect(processPrivateWhatsAppErasureBatch(firstEvent, testDeps)).resolves.toEqual(
      err({ code: 'INTERNAL_ERROR', message: 'publish failed' })
    );
    await expect(processPrivateWhatsAppErasureBatch(firstEvent, testDeps)).resolves.toEqual(
      ok({ status: 'replayed' })
    );
    expect(delivered).toEqual([{ ...firstEvent, attempt: 1 }]);
    const replayedEvent = delivered[0];
    if (replayedEvent === undefined) throw new Error('Expected replayed erasure event');
    await expect(processPrivateWhatsAppErasureBatch(replayedEvent, testDeps)).resolves.toEqual(
      ok({ status: 'completed' })
    );
    expect(current.status).toBe('completed');
    expect(telemetry.record.mock.calls.map(([record]) => record.outcome)).toEqual([
      'failed',
      'replay',
      'completed',
    ]);
  });

  it('concurrent stale retries only replay the current fenced attempt', async () => {
    const current = { ...baseRequest, status: 'running' as const, attempt: 2 };
    const testDeps = deps({
      repository: {
        advanceOneBatch: vi.fn().mockResolvedValue(ok({ status: 'stale' })),
        get: vi.fn().mockResolvedValue(ok(current)),
      },
    });
    const staleEvent = {
      type: 'whatsapp.private-account.erasure' as const,
      sourceAccountId: 'source-1',
      userId: 'user-1',
      erasureRequestId: 'erase-1',
      attempt: 1,
    };

    await expect(
      Promise.all([
        processPrivateWhatsAppErasureBatch(staleEvent, testDeps),
        processPrivateWhatsAppErasureBatch(staleEvent, testDeps),
      ])
    ).resolves.toEqual([ok({ status: 'replayed' }), ok({ status: 'replayed' })]);
    expect(testDeps.publisher.publishPrivateWhatsAppErasure).toHaveBeenCalledTimes(2);
    expect(testDeps.publisher.publishPrivateWhatsAppErasure).toHaveBeenNthCalledWith(1, {
      ...staleEvent,
      attempt: 2,
    });
    expect(testDeps.publisher.publishPrivateWhatsAppErasure).toHaveBeenNthCalledWith(2, {
      ...staleEvent,
      attempt: 2,
    });
  });

  it.each(['completed', 'failed'] as const)(
    'acks a stale delivery for a %s current request without replaying',
    async (status) => {
      const current = {
        ...baseRequest,
        status,
        ...(status === 'completed' ? { stage: 'completed' as const } : {}),
      };
      const testDeps = deps({
        repository: {
          advanceOneBatch: vi.fn().mockResolvedValue(ok({ status: 'stale' })),
          get: vi.fn().mockResolvedValue(ok(current)),
        },
      });

      await expect(
        processPrivateWhatsAppErasureBatch(
          {
            type: 'whatsapp.private-account.erasure',
            sourceAccountId: 'source-1',
            userId: 'user-1',
            erasureRequestId: 'erase-1',
            attempt: 0,
          },
          testDeps
        )
      ).resolves.toEqual(ok({ status: 'stale' }));
      expect(testDeps.publisher.publishPrivateWhatsAppErasure).not.toHaveBeenCalled();
    }
  );

  it('keeps stale recovery retryable for status-read and replay-publish failures and hides mismatches', async () => {
    const staleEvent = {
      type: 'whatsapp.private-account.erasure' as const,
      sourceAccountId: 'source-1',
      userId: 'user-1',
      erasureRequestId: 'erase-1',
      attempt: 0,
    };
    const readFailure = deps({
      repository: {
        advanceOneBatch: vi.fn().mockResolvedValue(ok({ status: 'stale' })),
        get: vi.fn().mockResolvedValue(
          err({ code: 'PERSISTENCE_ERROR', message: 'read failed' })
        ),
      },
    });
    await expect(processPrivateWhatsAppErasureBatch(staleEvent, readFailure)).resolves.toEqual(
      err({ code: 'PERSISTENCE_ERROR', message: 'read failed' })
    );

    const mismatch = deps({
      repository: {
        advanceOneBatch: vi.fn().mockResolvedValue(ok({ status: 'stale' })),
        get: vi.fn().mockResolvedValue(ok({ ...baseRequest, userId: 'foreign-user' })),
      },
    });
    await expect(processPrivateWhatsAppErasureBatch(staleEvent, mismatch)).resolves.toEqual(
      ok({ status: 'stale' })
    );
    expect(mismatch.publisher.publishPrivateWhatsAppErasure).not.toHaveBeenCalled();

    const replayFailure = deps({
      repository: {
        advanceOneBatch: vi.fn().mockResolvedValue(ok({ status: 'stale' })),
        get: vi.fn().mockResolvedValue(ok({ ...baseRequest, status: 'running', attempt: 1 })),
      },
      publisher: {
        publishPrivateWhatsAppErasure: vi.fn().mockResolvedValue(
          err({ code: 'INTERNAL_ERROR', message: 'replay failed' })
        ),
      },
    });
    await expect(processPrivateWhatsAppErasureBatch(staleEvent, replayFailure)).resolves.toEqual(
      err({ code: 'INTERNAL_ERROR', message: 'replay failed' })
    );
  });
});
