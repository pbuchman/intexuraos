import { err, ok, type Logger, type Result } from '@intexuraos/common-core';
import { describe, expect, it, vi } from 'vitest';
import {
  createConversationAssistantContextAttachment,
  createConversationAssistantContextAttachmentRequestFingerprint,
  deriveConversationAssistantContextAttachmentId,
  prepareConversationAssistantContextAttachment,
  retryConversationAssistantContextAttachmentPreparation,
  toPublicConversationAssistantContextAttachment,
} from '../../../domain/conversation-assistant/contextAttachmentUseCases.js';
import type {
  CaptureConversationAssistantContextAttachmentInput,
  CaptureConversationAssistantContextAttachmentResult,
  ConversationAssistantContextAttachmentCreationDeps,
  ConversationAssistantContextAttachmentPreparationPublisher,
  ConversationAssistantContextAttachmentPreparationRequestedEvent,
  ConversationAssistantContextAttachmentRepository,
  ConversationAssistantContextAttachmentDeltaBuilder,
  ConversationAssistantContextAttachmentPreparationRepository,
  CompleteConversationAssistantContextAttachmentPreparationInput,
  ContextAttachmentPreparationFence,
  DeleteConversationAssistantContextAttachmentPreparedSnapshotInput,
  FailConversationAssistantContextAttachmentPreparationInput,
  FailQueuedConversationAssistantContextAttachmentPreparationInput,
  PersistConversationAssistantContextAttachmentPreparedSnapshotInput,
  RequeueConversationAssistantContextAttachmentPreparationInput,
  ResolveConversationAssistantContextAttachmentSessionResult,
} from '../../../domain/conversation-assistant/contextAttachmentPorts.js';
import type {
  ConversationAssistantContextAttachment,
  ConversationAssistantContextAttachmentPreparedSnapshot,
  ConversationAssistantSessionContinuation,
} from '../../../domain/conversation-assistant/types.js';
import type {
  ConversationAssistantOperationalTelemetry,
  ConversationAssistantTelemetryInput,
} from '../../../domain/conversation-assistant/operationalTelemetry.js';

const logger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
};

function creationDeps(
  repository: ConversationAssistantContextAttachmentRepository,
  preparationPublisher: ConversationAssistantContextAttachmentPreparationPublisher =
    new PreparationPublisherFake()
): ConversationAssistantContextAttachmentCreationDeps {
  return { repository, preparationPublisher };
}

describe('Conversation Assistant context attachments', () => {
  describe('deterministic identity', () => {
    it('derives the same attachment id for the same session generation and request', () => {
      const input = {
        sessionId: 'session-1',
        sessionGenerationId: 'generation-1',
        preparationRequestId: 'request-1',
      };

      expect(deriveConversationAssistantContextAttachmentId(input)).toBe(
        deriveConversationAssistantContextAttachmentId(input)
      );
      expect(deriveConversationAssistantContextAttachmentId(input)).toMatch(
        /^whatsapp_conv_context_attachment_[a-f0-9]{40}$/
      );
    });

    it('uses the session generation as an attachment identity fence', () => {
      const first = deriveConversationAssistantContextAttachmentId({
        sessionId: 'session-1',
        sessionGenerationId: 'generation-1',
        preparationRequestId: 'request-1',
      });
      const second = deriveConversationAssistantContextAttachmentId({
        sessionId: 'session-1',
        sessionGenerationId: 'generation-2',
        preparationRequestId: 'request-1',
      });

      expect(second).not.toBe(first);
    });

    it('reuses a fingerprint for an identical request body', () => {
      const input = {
        userId: 'user-1',
        sessionId: 'session-1',
        preparationRequestId: 'request-1',
        replacesAttachmentId: 'attachment-old',
      };

      expect(createConversationAssistantContextAttachmentRequestFingerprint(input)).toBe(
        createConversationAssistantContextAttachmentRequestFingerprint(input)
      );
    });

    it('changes the fingerprint when replacement intent changes', () => {
      const withoutReplacement =
        createConversationAssistantContextAttachmentRequestFingerprint({
          userId: 'user-1',
          sessionId: 'session-1',
          preparationRequestId: 'request-1',
        });
      const withReplacement = createConversationAssistantContextAttachmentRequestFingerprint({
        userId: 'user-1',
        sessionId: 'session-1',
        preparationRequestId: 'request-1',
        replacesAttachmentId: 'attachment-old',
      });

      expect(withReplacement).not.toBe(withoutReplacement);
    });
  });

  describe('capture', () => {
    it('creates a queued draft at the fixed repository cutoff without advancing session watermarks', async () => {
      const repository = new CaptureRepositoryFake();
      const continuationBefore = structuredClone(repository.continuation);

      const result = await createConversationAssistantContextAttachment(
        {
          userId: 'user-1',
          sessionId: 'session-1',
          requestId: 'request-1',
        },
        creationDeps(repository),
        logger
      );

      expect(result.kind).toBe('created');
      if (result.kind !== 'created') throw new Error('Expected a created attachment');
      expect(result.attachment).toMatchObject({
        status: 'queued',
        sessionGenerationId: 'generation-1',
        sourceAccountId: 'source-account-1',
        chatId: 'chat-1',
        initialContextFrom: '2026-07-14T00:00:00.000Z',
        baseContextVersion: 3,
        baseEventThrough: '2026-07-17T18:00:00.000Z',
        baseChangeSeq: 20,
        cutoffChangeSeq: 24,
        capturedAt: '2026-07-19T10:14:00.000Z',
        captureRange: {
          from: '2026-07-17T18:00:00.000Z',
          to: '2026-07-19T10:14:00.000Z',
        },
      });
      expect(repository.continuation).toEqual(continuationBefore);
    });

    it('publishes preparation only after the attachment capture is committed', async () => {
      const repository = new CaptureRepositoryFake();
      const publisher = new PreparationPublisherFake();
      publisher.onPublish = (event): void => {
        expect(repository.attachments.has(event.attachmentId)).toBe(true);
      };

      const result = await createConversationAssistantContextAttachment(
        { userId: 'user-1', sessionId: 'session-1', requestId: 'request-publish-order' },
        creationDeps(repository, publisher),
        logger
      );

      expect(result.kind).toBe('created');
      expect(publisher.events).toEqual([
        expect.objectContaining({
          type: 'whatsapp.conversation-assistant.context-attachment.prepare',
          userId: 'user-1',
          sessionId: 'session-1',
          sessionGenerationId: 'generation-1',
          attempt: 1,
        }),
      ]);
    });

    it('safely republishes an identical replay', async () => {
      const repository = new CaptureRepositoryFake();
      const publisher = new PreparationPublisherFake();

      const first = await createConversationAssistantContextAttachment(
        { userId: 'user-1', sessionId: 'session-1', requestId: 'request-republish' },
        creationDeps(repository, publisher),
        logger
      );
      const replay = await createConversationAssistantContextAttachment(
        { userId: 'user-1', sessionId: 'session-1', requestId: 'request-republish' },
        creationDeps(repository, publisher),
        logger
      );

      expect(first.kind).toBe('created');
      expect(replay.kind).toBe('replay');
      expect(publisher.events).toHaveLength(2);
      expect(publisher.events[1]).toEqual(publisher.events[0]);
    });

    it('marks queued capture failed after a definite publisher Result failure', async () => {
      const repository = new CaptureRepositoryFake();
      const publisher = new PreparationPublisherFake();
      publisher.result = err({ code: 'PUBLISH_FAILED', message: 'Safe publish failure' });

      const result = await createConversationAssistantContextAttachment(
        { userId: 'user-1', sessionId: 'session-1', requestId: 'request-publish-failure' },
        creationDeps(repository, publisher),
        logger
      );

      expect(result.kind).toBe('created');
      if (result.kind !== 'created') throw new Error('Expected a created attachment');
      expect(result.attachment).toMatchObject({
        status: 'failed',
        preparationError: { code: 'PUBLISH_FAILED', message: 'Safe publish failure' },
      });
    });

    it('leaves the committed attachment queued when publisher outcome is ambiguous', async () => {
      const repository = new CaptureRepositoryFake();
      const publisher = new PreparationPublisherFake();
      publisher.throwOnPublish = true;

      await expect(
        createConversationAssistantContextAttachment(
          { userId: 'user-1', sessionId: 'session-1', requestId: 'request-publish-ambiguous' },
          creationDeps(repository, publisher),
          logger
        )
      ).rejects.toThrow('ambiguous publish outcome');
      expect([...repository.attachments.values()]).toEqual([
        expect.objectContaining({ status: 'queued' }),
      ]);
    });

    it('returns the committed queued capture when definite-failure CAS finds it deleted', async () => {
      const repository = new CaptureRepositoryFake();
      repository.queuedFailureStatusOverride = 'not_found';
      const publisher = new PreparationPublisherFake();
      publisher.result = err({ code: 'PUBLISH_FAILED', message: 'Safe publish failure' });

      const result = await createConversationAssistantContextAttachment(
        { userId: 'user-1', sessionId: 'session-1', requestId: 'request-cas-not-found' },
        creationDeps(repository, publisher),
        logger
      );

      expect(result.kind).toBe('created');
      if (result.kind !== 'created') throw new Error('Expected a created attachment');
      expect(result.attachment.status).toBe('queued');
    });

    it('replays the same deterministic attachment for the same normalized request', async () => {
      const repository = new CaptureRepositoryFake();

      const first = await createConversationAssistantContextAttachment(
        { userId: 'user-1', sessionId: 'session-1', requestId: 'request-replay' },
        creationDeps(repository),
        logger
      );
      const second = await createConversationAssistantContextAttachment(
        { userId: ' user-1 ', sessionId: ' session-1 ', requestId: ' request-replay ' },
        creationDeps(repository),
        logger
      );

      expect(first.kind).toBe('created');
      expect(second.kind).toBe('replay');
      if (first.kind !== 'created' || second.kind !== 'replay') {
        throw new Error('Expected created and replay outcomes');
      }
      expect(second.attachment.id).toBe(first.attachment.id);
      expect(repository.attachments.size).toBe(1);
    });

    it('returns a request-body conflict when replacement intent changes on replay', async () => {
      const repository = new CaptureRepositoryFake();
      const first = await createConversationAssistantContextAttachment(
        { userId: 'user-1', sessionId: 'session-1', requestId: 'request-conflict' },
        creationDeps(repository),
        logger
      );
      if (first.kind !== 'created') throw new Error('Expected a created attachment');

      const conflict = await createConversationAssistantContextAttachment(
        {
          userId: 'user-1',
          sessionId: 'session-1',
          requestId: 'request-conflict',
          replacesAttachmentId: first.attachment.id,
        },
        creationDeps(repository),
        logger
      );

      expect(conflict).toEqual({ kind: 'conflict', code: 'REQUEST_BODY_CONFLICT' });
    });

    it('creates two independent drafts at one committed base', async () => {
      const repository = new CaptureRepositoryFake();

      const first = await createConversationAssistantContextAttachment(
        { userId: 'user-1', sessionId: 'session-1', requestId: 'request-draft-a' },
        creationDeps(repository),
        logger
      );
      const second = await createConversationAssistantContextAttachment(
        { userId: 'user-1', sessionId: 'session-1', requestId: 'request-draft-b' },
        creationDeps(repository),
        logger
      );

      if (first.kind !== 'created' || second.kind !== 'created') {
        throw new Error('Expected two created attachments');
      }
      expect(second.attachment.id).not.toBe(first.attachment.id);
      expect(second.attachment).toMatchObject({
        baseContextVersion: first.attachment.baseContextVersion,
        baseEventThrough: first.attachment.baseEventThrough,
        baseChangeSeq: first.attachment.baseChangeSeq,
      });
    });

    it('persists explicit replacement intent without changing the frozen base', async () => {
      const repository = new CaptureRepositoryFake();

      const result = await createConversationAssistantContextAttachment(
        {
          userId: 'user-1',
          sessionId: 'session-1',
          requestId: 'request-refresh',
          replacesAttachmentId: 'attachment-old',
        },
        creationDeps(repository),
        logger
      );

      if (result.kind !== 'created') throw new Error('Expected a created attachment');
      expect(result.attachment).toMatchObject({
        replacesAttachmentId: 'attachment-old',
        baseContextVersion: 3,
        baseEventThrough: '2026-07-17T18:00:00.000Z',
        baseChangeSeq: 20,
      });
    });

    it('returns unsupported for a continuation-ineligible legacy session', async () => {
      const repository = new CaptureRepositoryFake();
      repository.resolveResultOverride = {
        status: 'unsupported',
        reason: 'legacy_session',
      };

      const result = await createConversationAssistantContextAttachment(
        { userId: 'user-1', sessionId: 'session-1', requestId: 'request-legacy' },
        creationDeps(repository),
        logger
      );

      expect(result).toEqual({ kind: 'unsupported', reason: 'legacy_session' });
      expect(repository.attachments.size).toBe(0);
    });

    it('returns not_found when session identity resolution is ownership-hidden', async () => {
      const repository = new CaptureRepositoryFake();
      repository.resolveResultOverride = { status: 'not_found' };

      const result = await createConversationAssistantContextAttachment(
        { userId: 'user-1', sessionId: 'session-1', requestId: 'request-hidden-session' },
        creationDeps(repository),
        logger
      );

      expect(result).toEqual({ kind: 'not_found' });
    });

    it('returns stale when the session generation changes before atomic capture', async () => {
      const repository = new CaptureRepositoryFake();
      repository.rotateGenerationAfterResolveTo = 'generation-2';

      const result = await createConversationAssistantContextAttachment(
        { userId: 'user-1', sessionId: 'session-1', requestId: 'request-generation-race' },
        creationDeps(repository),
        logger
      );

      expect(result).toEqual({ kind: 'stale' });
      expect(repository.attachments.size).toBe(0);
    });

    it.each([
      {
        repositoryResult: { status: 'not_found' as const },
        expected: { kind: 'not_found' as const },
      },
      {
        repositoryResult: {
          status: 'unsupported' as const,
          reason: 'source_unavailable' as const,
        },
        expected: { kind: 'unsupported' as const, reason: 'source_unavailable' as const },
      },
    ])('maps atomic capture status $repositoryResult.status', async ({ repositoryResult, expected }) => {
      const repository = new CaptureRepositoryFake();
      repository.captureResultOverride = repositoryResult;

      const result = await createConversationAssistantContextAttachment(
        { userId: 'user-1', sessionId: 'session-1', requestId: 'request-capture-status' },
        creationDeps(repository),
        logger
      );

      expect(result).toEqual(expected);
    });

    it.each([
      { requestId: '   ', replacesAttachmentId: undefined },
      { requestId: 'request-invalid-replacement', replacesAttachmentId: '   ' },
    ])('rejects invalid capture input before resolving the session', async (input) => {
      const repository = new CaptureRepositoryFake();

      const result = await createConversationAssistantContextAttachment(
        {
          userId: 'user-1',
          sessionId: 'session-1',
          requestId: input.requestId,
          ...(input.replacesAttachmentId === undefined
            ? {}
            : { replacesAttachmentId: input.replacesAttachmentId }),
        },
        creationDeps(repository),
        logger
      );

      expect(result.kind).toBe('invalid');
      expect(repository.resolveCallCount).toBe(0);
    });
  });

  describe('preparation', () => {
    it('prepares a queued attachment from its exact captured cutoff and marks it ready', async () => {
      const repository = new PreparationRepositoryFake();
      const creation = await createConversationAssistantContextAttachment(
        { userId: 'user-1', sessionId: 'session-1', requestId: 'request-1' },
        creationDeps(repository),
        logger
      );
      if (creation.kind !== 'created') throw new Error('Expected a created attachment');
      const deltaBuilder = new ExactCutoffDeltaBuilderFake();

      const result = await prepareConversationAssistantContextAttachment(
        {
          userId: 'user-1',
          sessionId: 'session-1',
          attachmentId: creation.attachment.id,
          sessionGenerationId: 'generation-1',
          attempt: 1,
          claimId: 'claim-1',
        },
        {
          repository,
          deltaBuilder,
          clock: { now: () => '2026-07-19T10:15:00.000Z' },
        },
        logger
      );

      expect(result.kind).toBe('ready');
      if (result.kind !== 'ready') throw new Error('Expected a ready attachment');
      expect(result.attachment).toMatchObject({
        status: 'ready',
        baseEventThrough: '2026-07-17T18:00:00.000Z',
        baseChangeSeq: 20,
        cutoffChangeSeq: 24,
        capturedAt: '2026-07-19T10:14:00.000Z',
        counts: { included: 4 },
        snapshotId: expect.stringMatching(/^whatsapp_conv_context_snapshot_[a-f0-9]{40}$/),
        chunkManifest: { chunkCount: 1 },
      });
      expect(deltaBuilder.builtBoundary).toEqual({
        sourceAccountId: 'source-account-1',
        chatId: 'chat-1',
        initialContextFrom: '2026-07-14T00:00:00.000Z',
        baseEventThrough: '2026-07-17T18:00:00.000Z',
        capturedAt: '2026-07-19T10:14:00.000Z',
        baseChangeSeq: 20,
        cutoffChangeSeq: 24,
      });
    });

    it('marks an exact-cutoff zero delta ready without treating it as an error', async () => {
      const repository = new PreparationRepositoryFake();
      repository.manifestChunkCount = 0;
      const creation = await createConversationAssistantContextAttachment(
        { userId: 'user-1', sessionId: 'session-1', requestId: 'request-zero-delta' },
        creationDeps(repository),
        logger
      );
      if (creation.kind !== 'created') throw new Error('Expected a created attachment');
      const deltaBuilder = new ExactCutoffDeltaBuilderFake();
      deltaBuilder.snapshotOverride = preparedSnapshot();

      const result = await prepareConversationAssistantContextAttachment(
        {
          userId: 'user-1',
          sessionId: 'session-1',
          attachmentId: creation.attachment.id,
          sessionGenerationId: 'generation-1',
          attempt: 1,
          claimId: 'claim-zero-delta',
        },
        {
          repository,
          deltaBuilder,
          clock: { now: () => '2026-07-19T10:15:00.000Z' },
        },
        logger
      );

      expect(result.kind).toBe('ready');
      if (result.kind !== 'ready') throw new Error('Expected a ready attachment');
      expect(result.attachment).toMatchObject({
        status: 'ready',
        counts: emptyCounts(),
        chunkManifest: { chunkIds: [], chunkCount: 0 },
      });
    });

    it('accepts an exact 400-chunk manifest', async () => {
      const repository = new PreparationRepositoryFake();
      repository.manifestChunkCount = 400;
      const creation = await createConversationAssistantContextAttachment(
        { userId: 'user-1', sessionId: 'session-1', requestId: 'request-400-chunks' },
        creationDeps(repository),
        logger
      );
      if (creation.kind !== 'created') throw new Error('Expected a created attachment');

      const result = await prepareConversationAssistantContextAttachment(
        {
          userId: 'user-1',
          sessionId: 'session-1',
          attachmentId: creation.attachment.id,
          sessionGenerationId: 'generation-1',
          attempt: 1,
          claimId: 'claim-400-chunks',
        },
        {
          repository,
          deltaBuilder: new ExactCutoffDeltaBuilderFake(),
          clock: { now: () => '2026-07-19T10:15:00.000Z' },
        },
        logger
      );

      expect(result.kind).toBe('ready');
      if (result.kind !== 'ready') throw new Error('Expected a ready attachment');
      expect(result.attachment.chunkManifest).toMatchObject({ chunkCount: 400 });
    });

    it('fails closed with ATTACHMENT_TOO_LARGE when persistence requires 401 chunks', async () => {
      const repository = new PreparationRepositoryFake();
      repository.manifestChunkCount = 401;
      const creation = await createConversationAssistantContextAttachment(
        { userId: 'user-1', sessionId: 'session-1', requestId: 'request-large' },
        creationDeps(repository),
        logger
      );
      if (creation.kind !== 'created') throw new Error('Expected a created attachment');

      const result = await prepareConversationAssistantContextAttachment(
        {
          userId: 'user-1',
          sessionId: 'session-1',
          attachmentId: creation.attachment.id,
          sessionGenerationId: 'generation-1',
          attempt: 1,
          claimId: 'claim-large',
        },
        {
          repository,
          deltaBuilder: new ExactCutoffDeltaBuilderFake(),
          clock: { now: () => '2026-07-19T10:15:00.000Z' },
        },
        logger
      );

      expect(result.kind).toBe('failed');
      if (result.kind !== 'failed') throw new Error('Expected a failed attachment');
      expect(result.attachment).toMatchObject({
        status: 'failed',
        preparationError: {
          code: 'ATTACHMENT_TOO_LARGE',
          message: 'This context attachment exceeds the 400 chunk limit',
        },
      });
      expect(result.attachment.chunkManifest).toBeUndefined();
    });

    it('rejects and cleans a persisted manifest that exceeds the hard limit', async () => {
      const repository = new PreparationRepositoryFake();
      repository.manifestChunkCount = 401;
      repository.ignoreMaxChunkCount = true;
      const creation = await createConversationAssistantContextAttachment(
        { userId: 'user-1', sessionId: 'session-1', requestId: 'request-oversized-manifest' },
        creationDeps(repository),
        logger
      );
      if (creation.kind !== 'created') throw new Error('Expected a created attachment');

      const result = await prepareConversationAssistantContextAttachment(
        {
          userId: 'user-1',
          sessionId: 'session-1',
          attachmentId: creation.attachment.id,
          sessionGenerationId: 'generation-1',
          attempt: 1,
          claimId: 'claim-oversized-manifest',
        },
        {
          repository,
          deltaBuilder: new ExactCutoffDeltaBuilderFake(),
          clock: { now: () => '2026-07-19T10:15:00.000Z' },
        },
        logger
      );

      expect(result.kind).toBe('failed');
      expect(repository.deletedSnapshotChunkCounts).toEqual([401]);
    });

    it('fails closed and cleans chunks when the persisted manifest is incomplete', async () => {
      const repository = new PreparationRepositoryFake();
      repository.manifestChunkCount = 2;
      repository.manifestChunkIdCount = 1;
      const creation = await createConversationAssistantContextAttachment(
        { userId: 'user-1', sessionId: 'session-1', requestId: 'request-incomplete-manifest' },
        creationDeps(repository),
        logger
      );
      if (creation.kind !== 'created') throw new Error('Expected a created attachment');

      const result = await prepareConversationAssistantContextAttachment(
        {
          userId: 'user-1',
          sessionId: 'session-1',
          attachmentId: creation.attachment.id,
          sessionGenerationId: 'generation-1',
          attempt: 1,
          claimId: 'claim-incomplete-manifest',
        },
        {
          repository,
          deltaBuilder: new ExactCutoffDeltaBuilderFake(),
          clock: { now: () => '2026-07-19T10:15:00.000Z' },
        },
        logger
      );

      expect(result.kind).toBe('failed');
      if (result.kind !== 'failed') throw new Error('Expected a failed attachment');
      expect(result.attachment.preparationError?.code).toBe(
        'ATTACHMENT_SNAPSHOT_INCOMPLETE'
      );
      expect(repository.deletedSnapshotChunkCounts).toEqual([1]);
    });

    it('persists a sanitized failure when exact-cutoff delta construction fails', async () => {
      const repository = new PreparationRepositoryFake();
      const creation = await createConversationAssistantContextAttachment(
        { userId: 'user-1', sessionId: 'session-1', requestId: 'request-builder-failure' },
        creationDeps(repository),
        logger
      );
      if (creation.kind !== 'created') throw new Error('Expected a created attachment');
      const deltaBuilder = new ExactCutoffDeltaBuilderFake();
      deltaBuilder.failure = {
        code: 'SOURCE_UNAVAILABLE',
        message: 'The source conversation is unavailable',
      };

      const result = await prepareConversationAssistantContextAttachment(
        {
          userId: 'user-1',
          sessionId: 'session-1',
          attachmentId: creation.attachment.id,
          sessionGenerationId: 'generation-1',
          attempt: 1,
          claimId: 'claim-builder-failure',
        },
        {
          repository,
          deltaBuilder,
          clock: { now: () => '2026-07-19T10:15:00.000Z' },
        },
        logger
      );

      expect(result.kind).toBe('failed');
      if (result.kind !== 'failed') throw new Error('Expected a failed attachment');
      expect(result.attachment.preparationError).toEqual(deltaBuilder.failure);
    });

    it('does not persist a thrown delta-builder message', async () => {
      const repository = new PreparationRepositoryFake();
      const creation = await createConversationAssistantContextAttachment(
        { userId: 'user-1', sessionId: 'session-1', requestId: 'request-builder-throw' },
        creationDeps(repository),
        logger
      );
      if (creation.kind !== 'created') throw new Error('Expected a created attachment');
      const deltaBuilder = new ExactCutoffDeltaBuilderFake();
      deltaBuilder.throwOnBuild = true;

      const result = await prepareConversationAssistantContextAttachment(
        {
          userId: 'user-1',
          sessionId: 'session-1',
          attachmentId: creation.attachment.id,
          sessionGenerationId: 'generation-1',
          attempt: 1,
          claimId: 'claim-builder-throw',
        },
        {
          repository,
          deltaBuilder,
          clock: { now: () => '2026-07-19T10:15:00.000Z' },
        },
        logger
      );

      expect(result.kind).toBe('failed');
      if (result.kind !== 'failed') throw new Error('Expected a failed attachment');
      expect(result.attachment.preparationError).toEqual({
        code: 'ATTACHMENT_PREPARATION_FAILED',
        message: 'The context attachment could not be prepared',
      });
    });

    it('returns stale before building when the session generation fence changed', async () => {
      const repository = new PreparationRepositoryFake();
      const creation = await createConversationAssistantContextAttachment(
        { userId: 'user-1', sessionId: 'session-1', requestId: 'request-stale-generation' },
        creationDeps(repository),
        logger
      );
      if (creation.kind !== 'created') throw new Error('Expected a created attachment');
      const deltaBuilder = new ExactCutoffDeltaBuilderFake();

      const result = await prepareConversationAssistantContextAttachment(
        {
          userId: 'user-1',
          sessionId: 'session-1',
          attachmentId: creation.attachment.id,
          sessionGenerationId: 'generation-2',
          attempt: 1,
          claimId: 'claim-stale-generation',
        },
        {
          repository,
          deltaBuilder,
          clock: { now: () => '2026-07-19T10:15:00.000Z' },
        },
        logger
      );

      expect(result).toEqual({ kind: 'stale' });
      expect(deltaBuilder.builtBoundary).toBeUndefined();
    });

    it('returns busy while another unexpired preparation claim owns the attachment', async () => {
      const repository = new PreparationRepositoryFake();
      const creation = await createConversationAssistantContextAttachment(
        { userId: 'user-1', sessionId: 'session-1', requestId: 'request-busy' },
        creationDeps(repository),
        logger
      );
      if (creation.kind !== 'created') throw new Error('Expected a created attachment');
      repository.attachments.set(creation.attachment.id, {
        ...creation.attachment,
        status: 'preparing',
        preparationClaimId: 'claim-existing',
        preparationLeaseExpiresAt: '2026-07-19T10:20:00.000Z',
      });

      const result = await prepareConversationAssistantContextAttachment(
        {
          userId: 'user-1',
          sessionId: 'session-1',
          attachmentId: creation.attachment.id,
          sessionGenerationId: 'generation-1',
          attempt: 1,
          claimId: 'claim-new',
        },
        {
          repository,
          deltaBuilder: new ExactCutoffDeltaBuilderFake(),
          clock: { now: () => '2026-07-19T10:15:00.000Z' },
        },
        logger
      );

      expect(result).toEqual({ kind: 'busy' });
    });

    it('returns not_found for a missing attachment', async () => {
      const repository = new PreparationRepositoryFake();

      const result = await prepareConversationAssistantContextAttachment(
        {
          userId: 'user-1',
          sessionId: 'session-1',
          attachmentId: 'missing-attachment',
          sessionGenerationId: 'generation-1',
          attempt: 1,
          claimId: 'claim-missing',
        },
        {
          repository,
          deltaBuilder: new ExactCutoffDeltaBuilderFake(),
          clock: { now: () => '2026-07-19T10:15:00.000Z' },
        },
        logger
      );

      expect(result).toEqual({ kind: 'not_found' });
    });

    it('returns expired without building an expired attachment', async () => {
      const repository = new PreparationRepositoryFake();
      const creation = await createConversationAssistantContextAttachment(
        { userId: 'user-1', sessionId: 'session-1', requestId: 'request-expired' },
        creationDeps(repository),
        logger
      );
      if (creation.kind !== 'created') throw new Error('Expected a created attachment');
      repository.attachments.set(creation.attachment.id, {
        ...creation.attachment,
        status: 'expired',
      });

      const result = await prepareConversationAssistantContextAttachment(
        {
          userId: 'user-1',
          sessionId: 'session-1',
          attachmentId: creation.attachment.id,
          sessionGenerationId: 'generation-1',
          attempt: 1,
          claimId: 'claim-expired',
        },
        {
          repository,
          deltaBuilder: new ExactCutoffDeltaBuilderFake(),
          clock: { now: () => '2026-07-19T10:15:00.000Z' },
        },
        logger
      );

      expect(result).toEqual({ kind: 'expired' });
    });

    it('cleans prepared chunks when the preparation lease expires before ready publication', async () => {
      const repository = new PreparationRepositoryFake();
      const creation = await createConversationAssistantContextAttachment(
        { userId: 'user-1', sessionId: 'session-1', requestId: 'request-lease-expiry' },
        creationDeps(repository),
        logger
      );
      if (creation.kind !== 'created') throw new Error('Expected a created attachment');
      const times = [
        '2026-07-19T10:15:00.000Z',
        '2026-07-19T10:16:00.000Z',
        '2026-07-19T10:21:00.000Z',
      ];

      const result = await prepareConversationAssistantContextAttachment(
        {
          userId: 'user-1',
          sessionId: 'session-1',
          attachmentId: creation.attachment.id,
          sessionGenerationId: 'generation-1',
          attempt: 1,
          claimId: 'claim-lease-expiry',
        },
        {
          repository,
          deltaBuilder: new ExactCutoffDeltaBuilderFake(),
          clock: { now: () => times.shift() ?? '2026-07-19T10:21:00.000Z' },
        },
        logger
      );

      expect(result).toEqual({ kind: 'expired' });
      expect(repository.deletedSnapshotChunkCounts).toEqual([1]);
    });

    it('cleans orphan chunks when the completion claim fence is lost', async () => {
      const repository = new PreparationRepositoryFake();
      repository.completionStatusOverride = 'stale';
      const creation = await createConversationAssistantContextAttachment(
        { userId: 'user-1', sessionId: 'session-1', requestId: 'request-lost-fence' },
        creationDeps(repository),
        logger
      );
      if (creation.kind !== 'created') throw new Error('Expected a created attachment');

      const result = await prepareConversationAssistantContextAttachment(
        {
          userId: 'user-1',
          sessionId: 'session-1',
          attachmentId: creation.attachment.id,
          sessionGenerationId: 'generation-1',
          attempt: 1,
          claimId: 'claim-lost-fence',
        },
        {
          repository,
          deltaBuilder: new ExactCutoffDeltaBuilderFake(),
          clock: { now: () => '2026-07-19T10:15:00.000Z' },
        },
        logger
      );

      expect(result).toEqual({ kind: 'stale' });
      expect(repository.deletedSnapshotChunkCounts).toEqual([1]);
    });

    it('fails and cleans chunks when ready publication detects a missing chunk', async () => {
      const repository = new PreparationRepositoryFake();
      repository.completionStatusOverride = 'missing_chunks';
      const creation = await createConversationAssistantContextAttachment(
        { userId: 'user-1', sessionId: 'session-1', requestId: 'request-missing-chunk' },
        creationDeps(repository),
        logger
      );
      if (creation.kind !== 'created') throw new Error('Expected a created attachment');

      const result = await prepareConversationAssistantContextAttachment(
        {
          userId: 'user-1',
          sessionId: 'session-1',
          attachmentId: creation.attachment.id,
          sessionGenerationId: 'generation-1',
          attempt: 1,
          claimId: 'claim-missing-chunk',
        },
        {
          repository,
          deltaBuilder: new ExactCutoffDeltaBuilderFake(),
          clock: { now: () => '2026-07-19T10:15:00.000Z' },
        },
        logger
      );

      expect(result.kind).toBe('failed');
      if (result.kind !== 'failed') throw new Error('Expected a failed attachment');
      expect(result.attachment.preparationError?.code).toBe(
        'ATTACHMENT_SNAPSHOT_INCOMPLETE'
      );
      expect(repository.deletedSnapshotChunkCounts).toEqual([1]);
    });

    it('returns stale when the preparation fence is lost before chunks are persisted', async () => {
      const repository = new PreparationRepositoryFake();
      repository.persistenceStatusOverride = 'stale';
      const creation = await createConversationAssistantContextAttachment(
        { userId: 'user-1', sessionId: 'session-1', requestId: 'request-stale-persist' },
        creationDeps(repository),
        logger
      );
      if (creation.kind !== 'created') throw new Error('Expected a created attachment');

      const result = await prepareConversationAssistantContextAttachment(
        {
          userId: 'user-1',
          sessionId: 'session-1',
          attachmentId: creation.attachment.id,
          sessionGenerationId: 'generation-1',
          attempt: 1,
          claimId: 'claim-stale-persist',
        },
        {
          repository,
          deltaBuilder: new ExactCutoffDeltaBuilderFake(),
          clock: { now: () => '2026-07-19T10:15:00.000Z' },
        },
        logger
      );

      expect(result).toEqual({ kind: 'stale' });
      expect(repository.deletedSnapshotChunkCounts).toEqual([]);
    });

    it('does not overwrite a newer claim when persisting a preparation failure', async () => {
      const repository = new PreparationRepositoryFake();
      repository.failureStatusOverride = 'stale';
      const creation = await createConversationAssistantContextAttachment(
        { userId: 'user-1', sessionId: 'session-1', requestId: 'request-stale-failure' },
        creationDeps(repository),
        logger
      );
      if (creation.kind !== 'created') throw new Error('Expected a created attachment');
      const deltaBuilder = new ExactCutoffDeltaBuilderFake();
      deltaBuilder.failure = {
        code: 'SOURCE_UNAVAILABLE',
        message: 'The source conversation is unavailable',
      };

      const result = await prepareConversationAssistantContextAttachment(
        {
          userId: 'user-1',
          sessionId: 'session-1',
          attachmentId: creation.attachment.id,
          sessionGenerationId: 'generation-1',
          attempt: 1,
          claimId: 'claim-stale-failure',
        },
        {
          repository,
          deltaBuilder,
          clock: { now: () => '2026-07-19T10:15:00.000Z' },
        },
        logger
      );

      expect(result).toEqual({ kind: 'stale' });
    });

    it.each([
      { field: 'attempt', attempt: 0, claimId: 'claim-invalid' },
      { field: 'claimId', attempt: 1, claimId: '   ' },
    ])('rejects an invalid preparation $field before claiming', async ({ attempt, claimId }) => {
      const repository = new PreparationRepositoryFake();

      const result = await prepareConversationAssistantContextAttachment(
        {
          userId: 'user-1',
          sessionId: 'session-1',
          attachmentId: 'attachment-1',
          sessionGenerationId: 'generation-1',
          attempt,
          claimId,
        },
        {
          repository,
          deltaBuilder: new ExactCutoffDeltaBuilderFake(),
          clock: { now: () => '2026-07-19T10:15:00.000Z' },
        },
        logger
      );

      expect(result).toEqual({
        kind: 'invalid',
        code: 'INVALID_REQUEST',
        message: 'Invalid context attachment preparation request',
      });
    });

    it('requeues a failed attachment without recapturing its exact boundaries', async () => {
      const repository = new PreparationRepositoryFake();
      const creation = await createConversationAssistantContextAttachment(
        { userId: 'user-1', sessionId: 'session-1', requestId: 'request-fixed-retry' },
        creationDeps(repository),
        logger
      );
      if (creation.kind !== 'created') throw new Error('Expected a created attachment');
      const deltaBuilder = new ExactCutoffDeltaBuilderFake();
      deltaBuilder.failure = {
        code: 'SOURCE_UNAVAILABLE',
        message: 'The source conversation is unavailable',
      };
      const failed = await prepareConversationAssistantContextAttachment(
        {
          userId: 'user-1',
          sessionId: 'session-1',
          attachmentId: creation.attachment.id,
          sessionGenerationId: 'generation-1',
          attempt: 1,
          claimId: 'claim-fixed-retry',
        },
        {
          repository,
          deltaBuilder,
          clock: { now: () => '2026-07-19T10:15:00.000Z' },
        },
        logger
      );
      if (failed.kind !== 'failed') throw new Error('Expected a failed attachment');
      const frozenBoundary = {
        initialContextFrom: failed.attachment.initialContextFrom,
        capturedAt: failed.attachment.capturedAt,
        baseEventThrough: failed.attachment.baseEventThrough,
        baseChangeSeq: failed.attachment.baseChangeSeq,
        cutoffChangeSeq: failed.attachment.cutoffChangeSeq,
        captureRange: failed.attachment.captureRange,
      };

      const result = await retryConversationAssistantContextAttachmentPreparation(
        {
          userId: 'user-1',
          sessionId: 'session-1',
          attachmentId: creation.attachment.id,
          sessionGenerationId: 'generation-1',
        },
        { repository, clock: { now: () => '2026-07-19T10:16:00.000Z' } },
        logger
      );

      expect(result.kind).toBe('queued');
      if (result.kind !== 'queued') throw new Error('Expected a queued attachment');
      expect(result.attachment).toMatchObject({
        ...frozenBoundary,
        status: 'queued',
        preparationAttempt: 2,
      });
      expect(result.attachment.preparationError).toBeUndefined();
    });

    it('rejects an invalid retry before repository access', async () => {
      const repository = new PreparationRepositoryFake();

      const result = await retryConversationAssistantContextAttachmentPreparation(
        {
          userId: 'user-1',
          sessionId: 'session-1',
          attachmentId: '   ',
          sessionGenerationId: 'generation-1',
        },
        { repository, clock: { now: () => '2026-07-19T10:16:00.000Z' } },
        logger
      );

      expect(result).toEqual({
        kind: 'invalid',
        code: 'INVALID_REQUEST',
        message: 'Invalid context attachment retry request',
      });
    });

    it('returns invalid_state when retry targets a non-failed attachment', async () => {
      const repository = new PreparationRepositoryFake();
      const creation = await createConversationAssistantContextAttachment(
        { userId: 'user-1', sessionId: 'session-1', requestId: 'request-invalid-state' },
        creationDeps(repository),
        logger
      );
      if (creation.kind !== 'created') throw new Error('Expected a created attachment');

      const result = await retryConversationAssistantContextAttachmentPreparation(
        {
          userId: 'user-1',
          sessionId: 'session-1',
          attachmentId: creation.attachment.id,
          sessionGenerationId: 'generation-1',
        },
        { repository, clock: { now: () => '2026-07-19T10:16:00.000Z' } },
        logger
      );

      expect(result).toEqual({ kind: 'invalid_state' });
    });
  });

  describe('public DTO', () => {
    it('serializes only the explicit public attachment allowlist', () => {
      const internal: ConversationAssistantContextAttachment = {
        id: 'attachment-1',
        sessionId: 'session-1',
        userId: 'user-private',
        sessionGenerationId: 'generation-private',
        sourceAccountId: 'source-account-private',
        sourceAccountGeneration: 'source-account-private',
        chatId: 'chat-private',
        preparationRequestId: 'request-private',
        preparationRequestFingerprint: 'fingerprint-private',
        replacesAttachmentId: 'attachment-private',
        status: 'ready',
        initialContextFrom: '2026-07-14T00:00:00.000Z',
        baseContextVersion: 3,
        baseEventThrough: '2026-07-17T18:00:00.000Z',
        capturedAt: '2026-07-19T10:14:00.000Z',
        baseChangeSeq: 20,
        cutoffChangeSeq: 24,
        captureRange: {
          from: '2026-07-17T18:00:00.000Z',
          to: '2026-07-19T10:14:00.000Z',
        },
        eventRange: {
          from: '2026-07-18T08:00:00.000Z',
          to: '2026-07-19T09:00:00.000Z',
        },
        counts: {
          ...emptyCounts(),
          included: 4,
          redacted: 1,
          deleted: 2,
          completedTranscriptions: 1,
        },
        omitted: { ...emptyOmitted(), mediaOnly: 2 },
        snapshotId: 'snapshot-private',
        chunkManifest: { chunkIds: ['chunk-private'], chunkCount: 1 },
        deltaTranscriptSha256: 'delta-hash-private',
        previousContextChainSha256: 'previous-hash-private',
        resultingContextChainSha256: 'resulting-hash-private',
        estimatedInputTokens: 123,
        requiresConfirmation: true,
        confirmationToken: 'confirmation-opaque',
        preparationAttempt: 2,
        preparationClaimId: 'claim-private',
        preparationLeaseExpiresAt: '2026-07-19T10:20:00.000Z',
        preparationError: { code: 'WARNING', message: 'Safe public warning' },
        expiresAt: '2026-07-19T10:44:00.000Z',
        newerAvailableCount: 3,
      };

      const result = toPublicConversationAssistantContextAttachment(internal, {
        compatibility: 'current',
        newerAvailableCount: 3,
        newerAvailableCorrectionCount: 2,
      });

      expect(result).toEqual({
        id: 'attachment-1',
        status: 'ready',
        compatibility: 'current',
        capturedAt: '2026-07-19T10:14:00.000Z',
        captureRange: {
          from: '2026-07-17T18:00:00.000Z',
          to: '2026-07-19T10:14:00.000Z',
        },
        eventRange: {
          from: '2026-07-18T08:00:00.000Z',
          to: '2026-07-19T09:00:00.000Z',
        },
        counts: {
          included: 4,
          excluded: 0,
          completedTranscriptions: 1,
          edited: 0,
          redacted: 3,
          reactionsChanged: 0,
          lateIngested: 0,
        },
        omitted: { ...emptyOmitted(), mediaOnly: 2 },
        requiresConfirmation: true,
        confirmationToken: 'confirmation-opaque',
        error: {
          code: 'PREPARATION_FAILED',
          message: 'The context attachment could not be prepared',
        },
        expiresAt: '2026-07-19T10:44:00.000Z',
        newerAvailableCount: 3,
        newerAvailableCorrectionCount: 2,
      });
      for (const privateField of [
        'userId',
        'sessionGenerationId',
        'preparationRequestId',
        'preparationRequestFingerprint',
        'replacesAttachmentId',
        'sourceAccountId',
        'chatId',
        'initialContextFrom',
        'baseContextVersion',
        'baseEventThrough',
        'baseChangeSeq',
        'cutoffChangeSeq',
        'snapshotId',
        'chunkManifest',
        'deltaTranscriptSha256',
        'previousContextChainSha256',
        'resultingContextChainSha256',
        'preparationAttempt',
        'preparationClaimId',
        'preparationLeaseExpiresAt',
      ]) {
        expect(result).not.toHaveProperty(privateField);
      }
    });

    it('maps queued to preparing and exposes only an allowlisted size error', () => {
      const repository = new CaptureRepositoryFake();
      const attachment = {
        ...repository.createAttachmentForPublicTest(),
        status: 'queued' as const,
        preparationError: {
          code: 'ATTACHMENT_TOO_LARGE',
          message: 'internal details that must not be exposed',
        },
      };

      const result = toPublicConversationAssistantContextAttachment(attachment, {
        compatibility: 'stale',
        newerAvailableCount: 0,
        newerAvailableCorrectionCount: 0,
      });

      expect(result).toMatchObject({
        status: 'preparing',
        compatibility: 'stale',
        newerAvailableCount: 0,
        newerAvailableCorrectionCount: 0,
        error: {
          code: 'ATTACHMENT_TOO_LARGE',
          message: 'This update is too large to include in one question.',
        },
      });
    });

    it('maps the allowlisted source-unavailable error to fixed public text', () => {
      const repository = new CaptureRepositoryFake();
      const attachment = {
        ...repository.createAttachmentForPublicTest(),
        status: 'failed' as const,
        preparationError: {
          code: 'SOURCE_UNAVAILABLE',
          message: 'unsafe provider detail',
        },
      };

      const result = toPublicConversationAssistantContextAttachment(attachment, {
        compatibility: 'current',
        newerAvailableCount: 0,
        newerAvailableCorrectionCount: 0,
      });

      expect(result.error).toEqual({
        code: 'PREPARATION_FAILED',
        message: 'The source conversation is unavailable',
      });
    });

    it('omits internal committed and preparation state from the public allowlist', () => {
      const repository = new CaptureRepositoryFake();
      const attachment = {
        ...repository.createAttachmentForPublicTest(),
        status: 'committed' as const,
        committedAt: '2026-07-19T10:30:00.000Z',
      };
      delete attachment.expiresAt;

      const result = toPublicConversationAssistantContextAttachment(attachment, {
        compatibility: 'current',
        newerAvailableCount: 0,
        newerAvailableCorrectionCount: 0,
      });

      expect(result).toMatchObject({
        status: 'committed',
      });
      expect(result).not.toHaveProperty('committedAt');
      expect(result.error).toBeUndefined();
      expect(result.expiresAt).toBeUndefined();
      expect(result).not.toHaveProperty('estimatedInputTokens');
      expect(result.confirmationToken).toBeUndefined();
    });
  });

  describe('operational telemetry', () => {
    it('records a created request without content or identifiers', async () => {
      const repository = new CaptureRepositoryFake();
      const telemetry = new OperationalTelemetryFake();

      const result = await createConversationAssistantContextAttachment(
        {
          userId: 'private-user',
          sessionId: 'private-session',
          requestId: 'private-request',
        },
        { ...creationDeps(repository), telemetry },
        logger
      );

      expect(result.kind).toBe('created');
      expect(telemetry.inputs).toEqual([
        expect.objectContaining({
          operation: 'attachment_preparation',
          outcome: 'created',
          durationMs: expect.any(Number),
        }),
      ]);
      expect(JSON.stringify(telemetry.inputs)).not.toMatch(
        /private-user|private-session|private-request/
      );
    });

    it.each([
      { included: 4, outcome: 'ready' as const },
      { included: 0, outcome: 'zero' as const },
    ])('records $outcome preparation aggregates', async ({ included, outcome }) => {
      const repository = new PreparationRepositoryFake();
      const creation = await createConversationAssistantContextAttachment(
        { userId: 'user-1', sessionId: 'session-1', requestId: `request-${outcome}` },
        creationDeps(repository),
        logger
      );
      if (creation.kind !== 'created') throw new Error('Expected a created attachment');
      const deltaBuilder = new ExactCutoffDeltaBuilderFake();
      const snapshot = preparedSnapshot({
        included,
        omitted: 2,
        newlyAvailable: included,
        edited: 1,
        redacted: 2,
        reactionsChanged: 3,
        lateIngested: 2,
        completedTranscriptions: 4,
      });
      snapshot.transcriptText = 'private transcript text';
      deltaBuilder.snapshotOverride = snapshot;
      const telemetry = new OperationalTelemetryFake();

      const result = await prepareConversationAssistantContextAttachment(
        {
          userId: 'user-1',
          sessionId: 'session-1',
          attachmentId: creation.attachment.id,
          sessionGenerationId: 'generation-1',
          attempt: 1,
          claimId: `claim-${outcome}`,
        },
        {
          repository,
          deltaBuilder,
          clock: { now: () => '2026-07-19T10:15:00.000Z' },
          telemetry,
        },
        logger
      );

      expect(result.kind).toBe('ready');
      expect(telemetry.inputs).toEqual([
        expect.objectContaining({
          operation: 'attachment_preparation',
          outcome,
          durationMs: expect.any(Number),
          estimatedBytes: Buffer.byteLength(JSON.stringify(snapshot), 'utf8'),
          count: included,
          includedCount: included,
          omittedCount: 2,
          correctedCount: 8,
          redactedCount: 2,
          newlyAvailableCount: included,
          lateIngestedCount: 2,
          estimatedTokens: 12,
        }),
      ]);
      expect(JSON.stringify(telemetry.inputs)).not.toContain('private transcript text');
    });

    it('records failed, expired, and rejected preparation outcomes', async () => {
      const telemetry = new OperationalTelemetryFake();

      const failedRepository = new PreparationRepositoryFake();
      const failedCreation = await createConversationAssistantContextAttachment(
        { userId: 'user-1', sessionId: 'session-1', requestId: 'request-failed-telemetry' },
        creationDeps(failedRepository),
        logger
      );
      if (failedCreation.kind !== 'created') throw new Error('Expected a created attachment');
      const failedBuilder = new ExactCutoffDeltaBuilderFake();
      failedBuilder.failure = { code: 'SOURCE_UNAVAILABLE', message: 'safe failure' };
      await prepareConversationAssistantContextAttachment(
        {
          userId: 'user-1',
          sessionId: 'session-1',
          attachmentId: failedCreation.attachment.id,
          sessionGenerationId: 'generation-1',
          attempt: 1,
          claimId: 'claim-failed-telemetry',
        },
        {
          repository: failedRepository,
          deltaBuilder: failedBuilder,
          clock: { now: () => '2026-07-19T10:15:00.000Z' },
          telemetry,
        },
        logger
      );

      const expiredRepository = new PreparationRepositoryFake();
      const expiredCreation = await createConversationAssistantContextAttachment(
        { userId: 'user-1', sessionId: 'session-1', requestId: 'request-expired-telemetry' },
        creationDeps(expiredRepository),
        logger
      );
      if (expiredCreation.kind !== 'created') throw new Error('Expected a created attachment');
      expiredRepository.attachments.set(expiredCreation.attachment.id, {
        ...expiredCreation.attachment,
        status: 'expired',
      });
      await prepareConversationAssistantContextAttachment(
        {
          userId: 'user-1',
          sessionId: 'session-1',
          attachmentId: expiredCreation.attachment.id,
          sessionGenerationId: 'generation-1',
          attempt: 1,
          claimId: 'claim-expired-telemetry',
        },
        {
          repository: expiredRepository,
          deltaBuilder: new ExactCutoffDeltaBuilderFake(),
          clock: { now: () => '2026-07-19T10:15:00.000Z' },
          telemetry,
        },
        logger
      );

      await prepareConversationAssistantContextAttachment(
        {
          userId: ' ',
          sessionId: 'session-1',
          attachmentId: 'attachment-1',
          sessionGenerationId: 'generation-1',
          attempt: 1,
          claimId: 'claim-rejected-telemetry',
        },
        {
          repository: new PreparationRepositoryFake(),
          deltaBuilder: new ExactCutoffDeltaBuilderFake(),
          clock: { now: () => '2026-07-19T10:15:00.000Z' },
          telemetry,
        },
        logger
      );

      expect(telemetry.inputs.map(({ outcome: recorded }) => recorded)).toEqual([
        'failed',
        'expired',
        'rejected',
      ]);
    });

    it('does not let telemetry failure change a successful preparation result', async () => {
      const repository = new PreparationRepositoryFake();
      const creation = await createConversationAssistantContextAttachment(
        { userId: 'user-1', sessionId: 'session-1', requestId: 'request-telemetry-failure' },
        creationDeps(repository),
        logger
      );
      if (creation.kind !== 'created') throw new Error('Expected a created attachment');
      const telemetry = new OperationalTelemetryFake();
      telemetry.error = new Error('metrics unavailable');

      const result = await prepareConversationAssistantContextAttachment(
        {
          userId: 'user-1',
          sessionId: 'session-1',
          attachmentId: creation.attachment.id,
          sessionGenerationId: 'generation-1',
          attempt: 1,
          claimId: 'claim-telemetry-failure',
        },
        {
          repository,
          deltaBuilder: new ExactCutoffDeltaBuilderFake(),
          clock: { now: () => '2026-07-19T10:15:00.000Z' },
          telemetry,
        },
        logger
      );

      expect(result.kind).toBe('ready');
    });

    it('records the number of orphan chunks removed after the completion fence is lost', async () => {
      const repository = new PreparationRepositoryFake();
      repository.completionStatusOverride = 'stale';
      repository.manifestChunkCount = 3;
      const creation = await createConversationAssistantContextAttachment(
        { userId: 'user-1', sessionId: 'session-1', requestId: 'request-orphan-metric' },
        creationDeps(repository),
        logger
      );
      if (creation.kind !== 'created') throw new Error('Expected a created attachment');
      const telemetry = new OperationalTelemetryFake();

      await prepareConversationAssistantContextAttachment(
        {
          userId: 'user-1',
          sessionId: 'session-1',
          attachmentId: creation.attachment.id,
          sessionGenerationId: 'generation-1',
          attempt: 1,
          claimId: 'claim-orphan-metric',
        },
        {
          repository,
          deltaBuilder: new ExactCutoffDeltaBuilderFake(),
          clock: { now: () => '2026-07-19T10:15:00.000Z' },
          telemetry,
        },
        logger
      );

      expect(telemetry.inputs).toEqual([
        expect.objectContaining({
          operation: 'attachment_preparation',
          outcome: 'stale',
          orphanCleanupCount: 3,
        }),
      ]);
    });

    it.each([
      { stage: 'claim' as const, hasEstimatedBytes: false },
      { stage: 'persist' as const, hasEstimatedBytes: true },
    ])('records an unexpected $stage failure with safe available aggregates', async ({
      stage,
      hasEstimatedBytes,
    }) => {
      const repository = new PreparationRepositoryFake();
      const creation = await createConversationAssistantContextAttachment(
        { userId: 'user-1', sessionId: 'session-1', requestId: `request-throw-${stage}` },
        creationDeps(repository),
        logger
      );
      if (creation.kind !== 'created') throw new Error('Expected a created attachment');
      if (stage === 'claim') {
        vi.spyOn(repository, 'claimContextAttachmentPreparation').mockRejectedValue(
          new Error('repository unavailable')
        );
      } else {
        vi.spyOn(repository, 'persistContextAttachmentPreparedSnapshot').mockRejectedValue(
          new Error('repository unavailable')
        );
      }
      const telemetry = new OperationalTelemetryFake();

      await expect(
        prepareConversationAssistantContextAttachment(
          {
            userId: 'user-1',
            sessionId: 'session-1',
            attachmentId: creation.attachment.id,
            sessionGenerationId: 'generation-1',
            attempt: 1,
            claimId: `claim-throw-${stage}`,
          },
          {
            repository,
            deltaBuilder: new ExactCutoffDeltaBuilderFake(),
            clock: { now: () => '2026-07-19T10:15:00.000Z' },
            telemetry,
          },
          logger
        )
      ).rejects.toThrow('repository unavailable');
      expect(telemetry.inputs).toEqual([
        {
          operation: 'attachment_preparation',
          outcome: 'failed',
          durationMs: expect.any(Number),
          ...(hasEstimatedBytes ? { estimatedBytes: expect.any(Number) } : {}),
        },
      ]);
    });
  });
});

class OperationalTelemetryFake implements ConversationAssistantOperationalTelemetry {
  readonly inputs: ConversationAssistantTelemetryInput[] = [];
  error?: Error;

  async record(input: ConversationAssistantTelemetryInput): Promise<void> {
    this.inputs.push(input);
    if (this.error !== undefined) throw this.error;
  }
}

class PreparationPublisherFake
  implements ConversationAssistantContextAttachmentPreparationPublisher
{
  readonly events: ConversationAssistantContextAttachmentPreparationRequestedEvent[] = [];
  result: Result<void, { code: string; message: string }> = ok(undefined);
  throwOnPublish = false;
  onPublish?: (event: ConversationAssistantContextAttachmentPreparationRequestedEvent) => void;

  async publish(
    event: ConversationAssistantContextAttachmentPreparationRequestedEvent
  ): ReturnType<ConversationAssistantContextAttachmentPreparationPublisher['publish']> {
    this.events.push(event);
    this.onPublish?.(event);
    if (this.throwOnPublish) throw new Error('ambiguous publish outcome');
    return this.result;
  }
}

class CaptureRepositoryFake implements ConversationAssistantContextAttachmentRepository {
  readonly attachments = new Map<string, ConversationAssistantContextAttachment>();
  resolveCallCount = 0;
  currentGenerationId = 'generation-1';
  rotateGenerationAfterResolveTo?: string;
  resolveResultOverride?: ResolveConversationAssistantContextAttachmentSessionResult;
  captureResultOverride?: Exclude<
    CaptureConversationAssistantContextAttachmentResult,
    { status: 'created' | 'replay' }
  >;
  queuedFailureStatusOverride?: 'not_found';
  readonly continuation: ConversationAssistantSessionContinuation = {
    sourceAccountId: 'source-account-1',
    contextVersion: 3,
    contextEventThrough: '2026-07-17T18:00:00.000Z',
    contextChangeThrough: 20,
    contextChainSha256: 'previous-chain-hash',
    displayTimeZone: 'Europe/Warsaw',
    nextTurnSequence: 5,
    nextConversationRevision: 3,
    completedConversationRevision: 2,
    attachmentCount: 2,
    totalAttachedMessageCount: 9,
    totalAttachedOmittedCount: 1,
  };

  createAttachmentForPublicTest(): ConversationAssistantContextAttachment {
    return {
      id: 'attachment-public-fixture',
      sessionId: 'session-1',
      userId: 'user-1',
      sessionGenerationId: 'generation-1',
      sourceAccountId: 'source-account-1',
      sourceAccountGeneration: 'source-account-1',
      chatId: 'chat-1',
      preparationRequestId: 'request-public-fixture',
      preparationRequestFingerprint: 'fingerprint-public-fixture',
      status: 'queued',
      initialContextFrom: '2026-07-14T00:00:00.000Z',
      baseContextVersion: this.continuation.contextVersion,
      baseEventThrough: this.continuation.contextEventThrough,
      capturedAt: '2026-07-19T10:14:00.000Z',
      baseChangeSeq: this.continuation.contextChangeThrough,
      cutoffChangeSeq: 24,
      captureRange: {
        from: this.continuation.contextEventThrough,
        to: '2026-07-19T10:14:00.000Z',
      },
      counts: emptyCounts(),
      omitted: emptyOmitted(),
      requiresConfirmation: false,
      preparationAttempt: 1,
      expiresAt: '2026-07-19T10:44:00.000Z',
    };
  }

  async resolveContextAttachmentSession(): Promise<ResolveConversationAssistantContextAttachmentSessionResult> {
    this.resolveCallCount += 1;
    if (this.resolveResultOverride !== undefined) return this.resolveResultOverride;
    const result = { status: 'found' as const, sessionGenerationId: this.currentGenerationId };
    if (this.rotateGenerationAfterResolveTo !== undefined) {
      this.currentGenerationId = this.rotateGenerationAfterResolveTo;
    }
    return result;
  }

  async captureContextAttachment(
    input: CaptureConversationAssistantContextAttachmentInput
  ): Promise<CaptureConversationAssistantContextAttachmentResult> {
    if (this.captureResultOverride !== undefined) return this.captureResultOverride;
    if (input.expectedSessionGenerationId !== this.currentGenerationId) {
      return { status: 'stale' };
    }
    const existing = this.attachments.get(input.attachmentId);
    if (existing !== undefined) {
      return existing.preparationRequestFingerprint === input.preparationRequestFingerprint
        ? { status: 'replay', attachment: existing }
        : { status: 'conflict' };
    }
    const attachment: ConversationAssistantContextAttachment = {
      id: input.attachmentId,
      sessionId: input.sessionId,
      userId: input.userId,
      sessionGenerationId: input.expectedSessionGenerationId,
      sourceAccountId: 'source-account-1',
      sourceAccountGeneration: 'source-account-1',
      chatId: 'chat-1',
      preparationRequestId: input.preparationRequestId,
      preparationRequestFingerprint: input.preparationRequestFingerprint,
      status: 'queued',
      initialContextFrom: '2026-07-14T00:00:00.000Z',
      baseContextVersion: this.continuation.contextVersion,
      baseEventThrough: this.continuation.contextEventThrough,
      capturedAt: '2026-07-19T10:14:00.000Z',
      baseChangeSeq: this.continuation.contextChangeThrough,
      cutoffChangeSeq: 24,
      captureRange: {
        from: this.continuation.contextEventThrough,
        to: '2026-07-19T10:14:00.000Z',
      },
      counts: emptyCounts(),
      omitted: emptyOmitted(),
      requiresConfirmation: false,
      preparationAttempt: 1,
      expiresAt: '2026-07-19T10:44:00.000Z',
      ...(input.replacesAttachmentId === undefined
        ? {}
        : { replacesAttachmentId: input.replacesAttachmentId }),
    };
    this.attachments.set(attachment.id, attachment);
    return { status: 'created', attachment };
  }

  async failQueuedContextAttachmentPreparation(
    input: FailQueuedConversationAssistantContextAttachmentPreparationInput
  ): ReturnType<
    ConversationAssistantContextAttachmentRepository['failQueuedContextAttachmentPreparation']
  > {
    if (this.queuedFailureStatusOverride === 'not_found') {
      return { status: 'not_found' as const };
    }
    const attachment = this.attachments.get(input.attachmentId);
    if (attachment === undefined) return { status: 'not_found' as const };
    if (
      attachment.userId !== input.userId ||
      attachment.sessionId !== input.sessionId ||
      attachment.sessionGenerationId !== input.expectedSessionGenerationId ||
      attachment.preparationAttempt !== input.attempt ||
      attachment.status !== 'queued'
    ) {
      return { status: 'stale' as const, attachment };
    }
    const failed: ConversationAssistantContextAttachment = {
      ...attachment,
      status: 'failed',
      preparationError: input.error,
    };
    this.attachments.set(failed.id, failed);
    return { status: 'failed' as const, attachment: failed };
  }
}

function emptyCounts(): ConversationAssistantContextAttachment['counts'] {
  return {
    included: 0,
    omitted: 0,
    newlyAvailable: 0,
    edited: 0,
    redacted: 0,
    deleted: 0,
    reactionsChanged: 0,
    lateIngested: 0,
    completedTranscriptions: 0,
  };
}

function emptyOmitted(): ConversationAssistantContextAttachment['omitted'] {
  return {
    mediaOnly: 0,
    failedTranscriptions: 0,
    pendingTranscriptions: 0,
    nonText: 0,
    overLimit: 0,
  };
}

class ExactCutoffDeltaBuilderFake
  implements ConversationAssistantContextAttachmentDeltaBuilder
{
  failure?: { code: string; message: string };
  snapshotOverride?: ConversationAssistantContextAttachmentPreparedSnapshot;
  throwOnBuild = false;
  builtBoundary?: {
    sourceAccountId: string;
    chatId: string;
    initialContextFrom: string;
    baseEventThrough: string;
    capturedAt: string;
    baseChangeSeq: number;
    cutoffChangeSeq: number;
  };

  async buildExactCutoffDelta(input: {
    attachment: ConversationAssistantContextAttachment;
  }): ReturnType<ConversationAssistantContextAttachmentDeltaBuilder['buildExactCutoffDelta']> {
    if (this.throwOnBuild) throw new Error('private message contents');
    this.builtBoundary = {
      sourceAccountId: input.attachment.sourceAccountId,
      chatId: input.attachment.chatId,
      initialContextFrom: input.attachment.initialContextFrom,
      baseEventThrough: input.attachment.baseEventThrough,
      capturedAt: input.attachment.capturedAt,
      baseChangeSeq: input.attachment.baseChangeSeq,
      cutoffChangeSeq: input.attachment.cutoffChangeSeq,
    };
    if (this.failure !== undefined) return err(this.failure);
    return ok(
      this.snapshotOverride ?? preparedSnapshot({ included: 4, newlyAvailable: 4 })
    );
  }
}

class PreparationRepositoryFake
  extends CaptureRepositoryFake
  implements ConversationAssistantContextAttachmentPreparationRepository
{
  manifestChunkCount = 1;
  manifestChunkIdCount?: number;
  ignoreMaxChunkCount = false;
  readonly deletedSnapshotChunkCounts: number[] = [];
  completionStatusOverride?: 'missing_chunks' | 'stale' | 'not_found';
  persistenceStatusOverride?: 'stale' | 'not_found' | 'expired';
  failureStatusOverride?: 'stale' | 'not_found' | 'expired';

  async claimContextAttachmentPreparation(input: ContextAttachmentPreparationFence & {
    now: string;
    leaseExpiresAt: string;
  }): ReturnType<
    ConversationAssistantContextAttachmentPreparationRepository['claimContextAttachmentPreparation']
  > {
    const attachment = this.attachments.get(input.attachmentId);
    if (attachment === undefined) return { status: 'not_found' as const };
    if (attachment.status === 'expired') return { status: 'expired' as const };
    if (attachment.sessionGenerationId !== input.expectedSessionGenerationId) {
      return { status: 'stale' as const };
    }
    if (attachment.preparationAttempt !== input.attempt || attachment.status !== 'queued') {
      return { status: 'busy' as const };
    }
    const preparing: ConversationAssistantContextAttachment = {
      ...attachment,
      status: 'preparing',
      preparationClaimId: input.claimId,
      preparationLeaseExpiresAt: input.leaseExpiresAt,
    };
    this.attachments.set(attachment.id, preparing);
    return { status: 'claimed' as const, attachment: preparing };
  }

  async persistContextAttachmentPreparedSnapshot(
    input: PersistConversationAssistantContextAttachmentPreparedSnapshotInput
  ): ReturnType<
    ConversationAssistantContextAttachmentPreparationRepository['persistContextAttachmentPreparedSnapshot']
  > {
    if (!this.hasFence(input)) return { status: 'stale' as const };
    if (this.persistenceStatusOverride !== undefined) {
      return { status: this.persistenceStatusOverride };
    }
    if (this.manifestChunkCount > input.maxChunkCount && !this.ignoreMaxChunkCount) {
      return { status: 'too_large' as const, chunkCount: this.manifestChunkCount };
    }
    return {
      status: 'saved' as const,
      manifest: {
        chunkIds: Array.from(
          { length: this.manifestChunkIdCount ?? this.manifestChunkCount },
          (_, index) => `${input.snapshotId}_${String(index).padStart(6, '0')}`
        ),
        chunkCount: this.manifestChunkCount,
      },
    };
  }

  async completeContextAttachmentPreparation(
    input: CompleteConversationAssistantContextAttachmentPreparationInput
  ): ReturnType<
    ConversationAssistantContextAttachmentPreparationRepository['completeContextAttachmentPreparation']
  > {
    const attachment = this.attachments.get(input.attachmentId);
    if (attachment === undefined) return { status: 'not_found' as const };
    if (!this.hasFence(input)) return { status: 'stale' as const };
    if (this.completionStatusOverride !== undefined) {
      return { status: this.completionStatusOverride };
    }
    if (
      attachment.preparationLeaseExpiresAt !== undefined &&
      input.now >= attachment.preparationLeaseExpiresAt
    ) {
      return { status: 'expired' as const };
    }
    const ready: ConversationAssistantContextAttachment = {
      ...attachment,
      status: 'ready',
      snapshotId: input.snapshotId,
      chunkManifest: input.manifest,
      ...(input.prepared.eventRange === undefined
        ? {}
        : { eventRange: input.prepared.eventRange }),
      counts: input.prepared.counts,
      omitted: input.prepared.omitted,
      deltaTranscriptSha256: input.prepared.deltaTranscriptSha256,
      previousContextChainSha256: input.prepared.previousContextChainSha256,
      resultingContextChainSha256: input.prepared.resultingContextChainSha256,
      estimatedInputTokens: input.prepared.estimatedInputTokens,
      requiresConfirmation: input.prepared.requiresConfirmation,
      ...(input.prepared.confirmationToken === undefined
        ? {}
        : { confirmationToken: input.prepared.confirmationToken }),
    };
    delete ready.preparationClaimId;
    delete ready.preparationLeaseExpiresAt;
    this.attachments.set(ready.id, ready);
    return { status: 'ready' as const, attachment: ready };
  }

  async failContextAttachmentPreparation(
    input: FailConversationAssistantContextAttachmentPreparationInput
  ): ReturnType<
    ConversationAssistantContextAttachmentPreparationRepository['failContextAttachmentPreparation']
  > {
    const attachment = this.attachments.get(input.attachmentId);
    if (attachment === undefined) return { status: 'not_found' as const };
    if (this.failureStatusOverride !== undefined) {
      return { status: this.failureStatusOverride };
    }
    if (!this.hasFence(input)) return { status: 'stale' as const };
    const failed: ConversationAssistantContextAttachment = {
      ...attachment,
      status: 'failed',
      preparationError: input.error,
    };
    delete failed.preparationClaimId;
    delete failed.preparationLeaseExpiresAt;
    this.attachments.set(failed.id, failed);
    return { status: 'failed' as const, attachment: failed };
  }

  async deleteContextAttachmentPreparedSnapshot(
    input: DeleteConversationAssistantContextAttachmentPreparedSnapshotInput
  ): Promise<void> {
    this.deletedSnapshotChunkCounts.push(input.chunkIds.length);
  }

  async requeueContextAttachmentPreparation(
    input: RequeueConversationAssistantContextAttachmentPreparationInput
  ): ReturnType<
    ConversationAssistantContextAttachmentPreparationRepository['requeueContextAttachmentPreparation']
  > {
    const attachment = this.attachments.get(input.attachmentId);
    if (attachment === undefined) return { status: 'not_found' as const };
    if (attachment.sessionGenerationId !== input.expectedSessionGenerationId) {
      return { status: 'stale' as const };
    }
    if (attachment.status === 'expired') return { status: 'expired' as const };
    if (attachment.status !== 'failed') return { status: 'invalid_state' as const };
    const queued: ConversationAssistantContextAttachment = {
      ...attachment,
      status: 'queued',
      preparationAttempt: attachment.preparationAttempt + 1,
    };
    delete queued.preparationError;
    this.attachments.set(queued.id, queued);
    return { status: 'queued' as const, attachment: queued };
  }

  private hasFence(input: ContextAttachmentPreparationFence): boolean {
    const attachment = this.attachments.get(input.attachmentId);
    return (
      attachment !== undefined &&
      attachment.userId === input.userId &&
      attachment.sessionId === input.sessionId &&
      attachment.sessionGenerationId === input.expectedSessionGenerationId &&
      attachment.preparationAttempt === input.attempt &&
      attachment.preparationClaimId === input.claimId &&
      attachment.status === 'preparing'
    );
  }
}

function preparedSnapshot(
  counts: Partial<ConversationAssistantContextAttachment['counts']> = {}
): ConversationAssistantContextAttachmentPreparedSnapshot {
  return {
    transcriptText: '',
    messages: [],
    omittedMessages: [],
    corrections: [],
    counts: { ...emptyCounts(), ...counts },
    omitted: emptyOmitted(),
    deltaTranscriptSha256: 'delta-transcript-hash',
    previousContextChainSha256: 'previous-chain-hash',
    resultingContextChainSha256: 'resulting-chain-hash',
    estimatedInputTokens: 12,
    requiresConfirmation: false,
  };
}
