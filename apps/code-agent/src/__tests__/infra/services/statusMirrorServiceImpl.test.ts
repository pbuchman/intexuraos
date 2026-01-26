/**
 * Tests for statusMirrorService
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStatusMirrorService } from '../../../infra/services/statusMirrorServiceImpl.js';
import { createMockLogger } from '../../helpers/mockLogger.js';
import { ok, err } from '@intexuraos/common-core';
import type { ActionsAgentClient } from '../../../infra/clients/actionsAgentClient.js';
import type { TaskStatus } from '../../../domain/models/codeTask.js';

// Mock ActionsAgentClient
const mockActionsAgentClient = {
  updateActionStatus: vi.fn(),
} as unknown as ActionsAgentClient;

describe('statusMirrorService', () => {
  const logger = createMockLogger();
  let mockUpdateActionStatus: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockUpdateActionStatus = vi.fn();
    (mockActionsAgentClient as ActionsAgentClient).updateActionStatus = mockUpdateActionStatus;
    vi.clearAllMocks();
  });

  describe('mirrorStatus', () => {
    it('should call actionsAgentClient with correct status mapping', async () => {
      mockUpdateActionStatus.mockResolvedValue(ok(undefined));

      const service = createStatusMirrorService({
        actionsAgentClient: mockActionsAgentClient,
        logger,
      });

      await service.mirrorStatus({
        actionId: 'action-123',
        taskStatus: 'completed',
        traceId: 'trace-123',
      });

      expect(mockUpdateActionStatus).toHaveBeenCalledWith(
        'action-123',
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

      expect(mockUpdateActionStatus).not.toHaveBeenCalled();
      expect(logger.debug).toHaveBeenCalledWith(
        { taskStatus: 'running' },
        'Skipping status mirror (no actionId)'
      );
    });

    it('should include resourceUrl when provided', async () => {
      mockUpdateActionStatus.mockResolvedValue(ok(undefined));

      const service = createStatusMirrorService({
        actionsAgentClient: mockActionsAgentClient,
        logger,
      });

      await service.mirrorStatus({
        actionId: 'action-123',
        taskStatus: 'completed',
        resourceUrl: 'https://github.com/pr/123',
      });

      expect(mockUpdateActionStatus).toHaveBeenCalledWith(
        'action-123',
        'completed',
        { prUrl: 'https://github.com/pr/123' },
        undefined
      );
    });

    it('should include errorMessage when provided', async () => {
      mockUpdateActionStatus.mockResolvedValue(ok(undefined));

      const service = createStatusMirrorService({
        actionsAgentClient: mockActionsAgentClient,
        logger,
      });

      await service.mirrorStatus({
        actionId: 'action-123',
        taskStatus: 'failed',
        errorMessage: 'CI failed',
      });

      expect(mockUpdateActionStatus).toHaveBeenCalledWith(
        'action-123',
        'failed',
        { error: 'CI failed' },
        undefined
      );
    });

    it('should not throw on client failure (non-fatal)', async () => {
      mockUpdateActionStatus.mockResolvedValue(
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
          actionId: 'action-123',
          taskStatus: 'running',
        })
      ).resolves.toBeUndefined();

      expect(logger.warn).toHaveBeenCalledWith(
        {
          actionId: 'action-123',
          taskStatus: 'running',
          error: { code: 'NETWORK_ERROR', message: 'Service down' },
        },
        'Failed to mirror status to action'
      );
    });

    it('should map completed statuses to completed', async () => {
      mockUpdateActionStatus.mockResolvedValue(ok(undefined));

      const service = createStatusMirrorService({
        actionsAgentClient: mockActionsAgentClient,
        logger,
      });

      await service.mirrorStatus({
        actionId: 'action-123',
        taskStatus: 'completed',
      });

      expect(mockUpdateActionStatus).toHaveBeenCalledWith('action-123', 'completed', undefined, undefined);
    });

    it('should map failed statuses to failed', async () => {
      mockUpdateActionStatus.mockResolvedValue(ok(undefined));

      const service = createStatusMirrorService({
        actionsAgentClient: mockActionsAgentClient,
        logger,
      });

      await service.mirrorStatus({
        actionId: 'action-123',
        taskStatus: 'failed',
      });

      expect(mockUpdateActionStatus).toHaveBeenCalledWith('action-123', 'failed', undefined, undefined);
    });

    it('should map cancelled status to cancelled', async () => {
      mockUpdateActionStatus.mockResolvedValue(ok(undefined));

      const service = createStatusMirrorService({
        actionsAgentClient: mockActionsAgentClient,
        logger,
      });

      await service.mirrorStatus({
        actionId: 'action-123',
        taskStatus: 'cancelled',
      });

      expect(mockUpdateActionStatus).toHaveBeenCalledWith('action-123', 'cancelled', undefined, undefined);
    });

    it('should map interrupted status to failed', async () => {
      mockUpdateActionStatus.mockResolvedValue(ok(undefined));

      const service = createStatusMirrorService({
        actionsAgentClient: mockActionsAgentClient,
        logger,
      });

      await service.mirrorStatus({
        actionId: 'action-123',
        taskStatus: 'interrupted',
      });

      expect(mockUpdateActionStatus).toHaveBeenCalledWith('action-123', 'failed', undefined, undefined);
    });

    it.each([
      ['dispatched', 'completed'],
      ['running', 'completed'],
      ['completed', 'completed'],
      ['failed', 'failed'],
      ['cancelled', 'cancelled'],
      ['interrupted', 'failed'],
    ])('should map %s to %s', async (taskStatus, expectedResourceStatus) => {
      mockUpdateActionStatus.mockResolvedValue(ok(undefined));

      const service = createStatusMirrorService({
        actionsAgentClient: mockActionsAgentClient,
        logger,
      });

      await service.mirrorStatus({
        actionId: 'action-123',
        taskStatus: taskStatus as TaskStatus,
      });

      expect(mockUpdateActionStatus).toHaveBeenCalledWith('action-123', expectedResourceStatus, undefined, undefined);
    });
  });
});
