/**
 * Tests for statusMirrorService
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStatusMirrorService } from '../../../infra/services/statusMirrorServiceImpl.js';
import { createMockLogger } from '../../helpers/mockLogger.js';
import { ok, err } from '@intexuraos/common-core';
import type { ActionsAgentClient } from '../../../infra/clients/actionsAgentClient.js';
import type { TaskStatus } from '../../../domain/models/codeTask.js';

describe('statusMirrorService', () => {
  const logger = createMockLogger();
  let mockActionsAgentClient: ActionsAgentClient;

  beforeEach(() => {
    mockActionsAgentClient = {
      updateActionStatus: vi.fn(),
    } as unknown as ActionsAgentClient;
    vi.clearAllMocks();
  });

  const getMockUpdateActionStatus = (): ReturnType<typeof vi.fn> =>
    mockActionsAgentClient.updateActionStatus as ReturnType<typeof vi.fn>;

  describe('mirrorStatus', () => {
    it('should call actionsAgentClient with correct status mapping', async () => {
      getMockUpdateActionStatus().mockResolvedValue(ok(undefined));

      const service = createStatusMirrorService({
        actionsAgentClient: mockActionsAgentClient,
        logger,
      });

      await service.mirrorStatus({
        actionId: '550e8400-e29b-41d4-a716-446655440000',
        taskStatus: 'implemented',
        traceId: 'trace-123',
      });

      expect(getMockUpdateActionStatus()).toHaveBeenCalledWith(
        '550e8400-e29b-41d4-a716-446655440000',
        'completed',
        undefined,
        'trace-123'
      );
    });

    it('should skip mirroring when actionId is undefined', async () => {
      const service = createStatusMirrorService({
        actionsAgentClient: mockActionsAgentClient,
        logger,
      });

      await service.mirrorStatus({
        actionId: undefined,
        taskStatus: 'running',
      });

      expect(getMockUpdateActionStatus()).not.toHaveBeenCalled();
      expect(logger.debug).toHaveBeenCalledWith(
        { taskStatus: 'running' },
        'Skipping status mirror (no actionId)'
      );
    });

    it('should include resourceUrl when provided', async () => {
      getMockUpdateActionStatus().mockResolvedValue(ok(undefined));

      const service = createStatusMirrorService({
        actionsAgentClient: mockActionsAgentClient,
        logger,
      });

      await service.mirrorStatus({
        actionId: '550e8400-e29b-41d4-a716-446655440000',
        taskStatus: 'implemented',
        resourceUrl: 'https://github.com/pr/123',
      });

      expect(getMockUpdateActionStatus()).toHaveBeenCalledWith(
        '550e8400-e29b-41d4-a716-446655440000',
        'completed',
        { prUrl: 'https://github.com/pr/123' },
        undefined
      );
    });

    it('should include errorMessage when provided', async () => {
      getMockUpdateActionStatus().mockResolvedValue(ok(undefined));

      const service = createStatusMirrorService({
        actionsAgentClient: mockActionsAgentClient,
        logger,
      });

      await service.mirrorStatus({
        actionId: '550e8400-e29b-41d4-a716-446655440000',
        taskStatus: 'failed',
        errorMessage: 'CI failed',
      });

      expect(getMockUpdateActionStatus()).toHaveBeenCalledWith(
        '550e8400-e29b-41d4-a716-446655440000',
        'failed',
        { error: 'CI failed' },
        undefined
      );
    });

    it('should not throw on client failure (non-fatal)', async () => {
      getMockUpdateActionStatus().mockResolvedValue(
        err({
          code: 'NETWORK_ERROR' as const,
          message: 'Service down',
        })
      );

      const service = createStatusMirrorService({
        actionsAgentClient: mockActionsAgentClient,
        logger,
      });

      await expect(
        service.mirrorStatus({
          actionId: '550e8400-e29b-41d4-a716-446655440000',
          taskStatus: 'running',
        })
      ).resolves.toBeUndefined();

      expect(logger.warn).toHaveBeenCalledWith(
        {
          actionId: '550e8400-e29b-41d4-a716-446655440000',
          taskStatus: 'running',
          error: { code: 'NETWORK_ERROR', message: 'Service down' },
        },
        'Failed to mirror status to action'
      );
    });

    it('should map completed statuses to completed', async () => {
      getMockUpdateActionStatus().mockResolvedValue(ok(undefined));

      const service = createStatusMirrorService({
        actionsAgentClient: mockActionsAgentClient,
        logger,
      });

      await service.mirrorStatus({
        actionId: '550e8400-e29b-41d4-a716-446655440000',
        taskStatus: 'implemented',
      });

      expect(getMockUpdateActionStatus()).toHaveBeenCalledWith('550e8400-e29b-41d4-a716-446655440000', 'completed', undefined, undefined);
    });

    it('should map failed statuses to failed', async () => {
      getMockUpdateActionStatus().mockResolvedValue(ok(undefined));

      const service = createStatusMirrorService({
        actionsAgentClient: mockActionsAgentClient,
        logger,
      });

      await service.mirrorStatus({
        actionId: '550e8400-e29b-41d4-a716-446655440000',
        taskStatus: 'failed',
      });

      expect(getMockUpdateActionStatus()).toHaveBeenCalledWith('550e8400-e29b-41d4-a716-446655440000', 'failed', undefined, undefined);
    });

    it('should map cancelled status to cancelled', async () => {
      getMockUpdateActionStatus().mockResolvedValue(ok(undefined));

      const service = createStatusMirrorService({
        actionsAgentClient: mockActionsAgentClient,
        logger,
      });

      await service.mirrorStatus({
        actionId: '550e8400-e29b-41d4-a716-446655440000',
        taskStatus: 'cancelled',
      });

      expect(getMockUpdateActionStatus()).toHaveBeenCalledWith('550e8400-e29b-41d4-a716-446655440000', 'cancelled', undefined, undefined);
    });

    it('should map interrupted status to interrupted', async () => {
      getMockUpdateActionStatus().mockResolvedValue(ok(undefined));

      const service = createStatusMirrorService({
        actionsAgentClient: mockActionsAgentClient,
        logger,
      });

      await service.mirrorStatus({
        actionId: '550e8400-e29b-41d4-a716-446655440000',
        taskStatus: 'interrupted',
      });

      expect(getMockUpdateActionStatus()).toHaveBeenCalledWith('550e8400-e29b-41d4-a716-446655440000', 'interrupted', undefined, undefined);
    });

    it('should map dispatched status to dispatched', async () => {
      getMockUpdateActionStatus().mockResolvedValue(ok(undefined));

      const service = createStatusMirrorService({
        actionsAgentClient: mockActionsAgentClient,
        logger,
      });

      await service.mirrorStatus({
        actionId: '550e8400-e29b-41d4-a716-446655440000',
        taskStatus: 'dispatched',
      });

      expect(getMockUpdateActionStatus()).toHaveBeenCalledWith('550e8400-e29b-41d4-a716-446655440000', 'dispatched', undefined, undefined);
    });

    it('should map running status to running', async () => {
      getMockUpdateActionStatus().mockResolvedValue(ok(undefined));

      const service = createStatusMirrorService({
        actionsAgentClient: mockActionsAgentClient,
        logger,
      });

      await service.mirrorStatus({
        actionId: '550e8400-e29b-41d4-a716-446655440000',
        taskStatus: 'running',
      });

      expect(getMockUpdateActionStatus()).toHaveBeenCalledWith('550e8400-e29b-41d4-a716-446655440000', 'running', undefined, undefined);
    });

    it.each([
      ['dispatched', 'dispatched'],
      ['running', 'running'],
      ['queued', 'dispatched'],
      ['planned', 'completed'],
      ['implemented', 'completed'],
      ['reviewed', 'completed'],
      ['failed', 'failed'],
      ['cancelled', 'cancelled'],
      ['interrupted', 'interrupted'],
      ['archived', 'completed'],
    ])('should map %s to %s', async (taskStatus, expectedResourceStatus) => {
      getMockUpdateActionStatus().mockResolvedValue(ok(undefined));

      const service = createStatusMirrorService({
        actionsAgentClient: mockActionsAgentClient,
        logger,
      });

      await service.mirrorStatus({
        actionId: '550e8400-e29b-41d4-a716-446655440000',
        taskStatus: taskStatus as TaskStatus,
      });

      expect(getMockUpdateActionStatus()).toHaveBeenCalledWith('550e8400-e29b-41d4-a716-446655440000', expectedResourceStatus, undefined, undefined);
    });
  });

  describe('synthetic actionId guard', () => {
    it('should skip mirroring for webhook-assign pattern', async () => {
      const service = createStatusMirrorService({
        actionsAgentClient: mockActionsAgentClient,
        logger,
      });

      await service.mirrorStatus({
        actionId: 'webhook-assign-INT-123-1234567890',
        taskStatus: 'running',
      });

      expect(getMockUpdateActionStatus()).not.toHaveBeenCalled();
      expect(logger.debug).toHaveBeenCalledWith(
        { actionId: 'webhook-assign-INT-123-1234567890', taskStatus: 'running' },
        'Skipping status mirror (synthetic actionId)'
      );
    });

    it('should skip mirroring for pr-comment pattern', async () => {
      const service = createStatusMirrorService({
        actionsAgentClient: mockActionsAgentClient,
        logger,
      });

      await service.mirrorStatus({
        actionId: 'pr-comment/owner/repo/42/evt123',
        taskStatus: 'running',
      });

      expect(getMockUpdateActionStatus()).not.toHaveBeenCalled();
      expect(logger.debug).toHaveBeenCalledWith(
        { actionId: 'pr-comment/owner/repo/42/evt123', taskStatus: 'running' },
        'Skipping status mirror (synthetic actionId)'
      );
    });

    it('should skip mirroring for merge-conflict pattern', async () => {
      const service = createStatusMirrorService({
        actionsAgentClient: mockActionsAgentClient,
        logger,
      });

      await service.mirrorStatus({
        actionId: 'merge-conflict/owner/repo/42/evt123',
        taskStatus: 'running',
      });

      expect(getMockUpdateActionStatus()).not.toHaveBeenCalled();
      expect(logger.debug).toHaveBeenCalledWith(
        { actionId: 'merge-conflict/owner/repo/42/evt123', taskStatus: 'running' },
        'Skipping status mirror (synthetic actionId)'
      );
    });

    it('should skip mirroring for fanout pattern', async () => {
      const service = createStatusMirrorService({
        actionsAgentClient: mockActionsAgentClient,
        logger,
      });

      await service.mirrorStatus({
        actionId: 'fanout_550e8400-e29b-41d4-a716-446655440000',
        taskStatus: 'running',
      });

      expect(getMockUpdateActionStatus()).not.toHaveBeenCalled();
      expect(logger.debug).toHaveBeenCalledWith(
        { actionId: 'fanout_550e8400-e29b-41d4-a716-446655440000', taskStatus: 'running' },
        'Skipping status mirror (synthetic actionId)'
      );
    });

    it('should call actionsAgentClient for real UUID actionId', async () => {
      getMockUpdateActionStatus().mockResolvedValue(ok(undefined));

      const service = createStatusMirrorService({
        actionsAgentClient: mockActionsAgentClient,
        logger,
      });

      await service.mirrorStatus({
        actionId: '550e8400-e29b-41d4-a716-446655440000',
        taskStatus: 'running',
      });

      expect(getMockUpdateActionStatus()).toHaveBeenCalledWith(
        '550e8400-e29b-41d4-a716-446655440000',
        'running',
        undefined,
        undefined
      );
    });

    it('should still skip mirroring when actionId is undefined', async () => {
      const service = createStatusMirrorService({
        actionsAgentClient: mockActionsAgentClient,
        logger,
      });

      await service.mirrorStatus({
        actionId: undefined,
        taskStatus: 'running',
      });

      expect(getMockUpdateActionStatus()).not.toHaveBeenCalled();
      expect(logger.debug).toHaveBeenCalledWith(
        { taskStatus: 'running' },
        'Skipping status mirror (no actionId)'
      );
    });
  });
});
