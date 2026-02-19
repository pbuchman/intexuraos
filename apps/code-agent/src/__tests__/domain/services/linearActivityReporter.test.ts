/**
 * Tests for Linear Activity Reporter.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  mapTaskEventToActivity,
  buildPlanSteps,
  createLinearActivityReporter,
} from '../../../domain/services/linearActivityReporter.js';
import type { LinearAgentApiClient } from '../../../domain/ports/linearAgentApiClient.js';
import { ok, err } from '@intexuraos/common-core';
import pino from 'pino';

describe('mapTaskEventToActivity', () => {
  it('maps task_dispatched to action type', () => {
    const result = mapTaskEventToActivity({ type: 'task_dispatched' });
    expect(result.type).toBe('action');
    expect(result.body).toContain('Starting');
  });

  it('maps phase1_start to thought type', () => {
    const result = mapTaskEventToActivity({ type: 'phase1_start' });
    expect(result.type).toBe('thought');
    expect(result.body).toContain('Analyzing');
  });

  it('maps phase1_complete to response type with default message', () => {
    const result = mapTaskEventToActivity({ type: 'phase1_complete' });
    expect(result.type).toBe('response');
    expect(result.body).toContain('enriched');
  });

  it('maps phase1_complete with custom details', () => {
    const result = mapTaskEventToActivity({
      type: 'phase1_complete',
      details: 'Custom details here',
    });
    expect(result.body).toBe('Custom details here');
  });

  it('maps phase2_start to action type', () => {
    const result = mapTaskEventToActivity({ type: 'phase2_start' });
    expect(result.type).toBe('action');
    expect(result.body).toContain('Implementing');
  });

  it('maps pr_created to response type with PR URL', () => {
    const result = mapTaskEventToActivity({
      type: 'pr_created',
      prUrl: 'https://github.com/org/repo/pull/123',
    });
    expect(result.type).toBe('response');
    expect(result.body).toContain('https://github.com/org/repo/pull/123');
  });

  it('maps pr_created to response type without PR URL', () => {
    const result = mapTaskEventToActivity({ type: 'pr_created' });
    expect(result.type).toBe('response');
    expect(result.body).toContain('Pull request created');
  });

  it('maps task_completed to response type with default message', () => {
    const result = mapTaskEventToActivity({ type: 'task_completed' });
    expect(result.type).toBe('response');
    expect(result.body).toContain('successfully');
  });

  it('maps task_completed with custom details', () => {
    const result = mapTaskEventToActivity({
      type: 'task_completed',
      details: 'All tests passed',
    });
    expect(result.body).toBe('All tests passed');
  });

  it('maps task_error to error type with default message', () => {
    const result = mapTaskEventToActivity({ type: 'task_error' });
    expect(result.type).toBe('error');
    expect(result.body).toContain('failed');
  });

  it('maps task_error with custom details', () => {
    const result = mapTaskEventToActivity({
      type: 'task_error',
      details: 'CI failed',
    });
    expect(result.body).toBe('CI failed');
  });

  it('maps task_timeout to error type', () => {
    const result = mapTaskEventToActivity({ type: 'task_timeout' });
    expect(result.type).toBe('error');
    expect(result.body).toContain('timed out');
  });
});

describe('buildPlanSteps', () => {
  it('returns 5 plan steps', () => {
    const steps = buildPlanSteps('task_dispatched');
    expect(steps).toHaveLength(5);
  });

  it('task_dispatched: all steps pending (phase 0)', () => {
    const steps = buildPlanSteps('task_dispatched');
    // Phase 0 - no steps have started yet
    expect(steps[0]?.status).toBe('pending');
    expect(steps[1]?.status).toBe('pending');
    expect(steps[2]?.status).toBe('pending');
    expect(steps[3]?.status).toBe('pending');
    expect(steps[4]?.status).toBe('pending');
  });

  it('phase1_start: first step in-progress', () => {
    const steps = buildPlanSteps('phase1_start');
    expect(steps[0]?.status).toBe('in-progress');
  });

  it('phase1_complete: first two completed, rest pending', () => {
    const steps = buildPlanSteps('phase1_complete');
    expect(steps[0]?.status).toBe('completed');
    expect(steps[1]?.status).toBe('completed');
    // Step 2 completedAt=4, phase 2 >= 4-1=3 → false → pending
    expect(steps[2]?.status).toBe('pending');
  });

  it('phase2_start: three items in-progress or completed', () => {
    const steps = buildPlanSteps('phase2_start');
    expect(steps[0]?.status).toBe('completed');
    expect(steps[1]?.status).toBe('completed');
    expect(steps[2]?.status).toBe('in-progress');
  });

  it('pr_created: first four completed, last in-progress', () => {
    const steps = buildPlanSteps('pr_created');
    expect(steps[0]?.status).toBe('completed');
    expect(steps[1]?.status).toBe('completed');
    expect(steps[2]?.status).toBe('completed');
    expect(steps[3]?.status).toBe('completed');
    expect(steps[4]?.status).toBe('in-progress');
  });

  it('task_completed: all steps completed', () => {
    const steps = buildPlanSteps('task_completed');
    expect(steps.every((s) => s.status === 'completed')).toBe(true);
  });

  it('task_error: first two completed, rest canceled', () => {
    const steps = buildPlanSteps('task_error');
    expect(steps[0]?.status).toBe('completed');
    expect(steps[1]?.status).toBe('completed');
    expect(steps[2]?.status).toBe('canceled');
    expect(steps[3]?.status).toBe('canceled');
    expect(steps[4]?.status).toBe('canceled');
  });

  it('task_timeout: first two completed, rest canceled', () => {
    const steps = buildPlanSteps('task_timeout');
    expect(steps[0]?.status).toBe('completed');
    expect(steps[1]?.status).toBe('completed');
    expect(steps[2]?.status).toBe('canceled');
  });
});

describe('LinearActivityReporter', () => {
  let mockClient: LinearAgentApiClient;
  let reporter: ReturnType<typeof createLinearActivityReporter>;
  const logger = pino({ name: 'test', level: 'silent' });

  beforeEach(() => {
    mockClient = {
      emitActivity: vi.fn().mockResolvedValue(ok(undefined)),
      updateSessionPlan: vi.fn().mockResolvedValue(ok(undefined)),
      updateSessionExternalUrls: vi.fn().mockResolvedValue(ok(undefined)),
    };
    reporter = createLinearActivityReporter({
      linearAgentApiClient: mockClient,
      logger,
    });
  });

  it('skips reporting when sessionId is undefined', async () => {
    await reporter.reportEvent({ type: 'task_dispatched' });

    expect(mockClient.emitActivity).not.toHaveBeenCalled();
    expect(mockClient.updateSessionPlan).not.toHaveBeenCalled();
  });

  it('emits activity and updates plan on task_dispatched', async () => {
    await reporter.reportEvent({
      type: 'task_dispatched',
      sessionId: 'session-123',
    });

    expect(mockClient.emitActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-123',
        type: 'action',
      })
    );
    expect(mockClient.updateSessionPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-123',
      })
    );
  });

  it('adds external URL when pr_created with prUrl', async () => {
    await reporter.reportEvent({
      type: 'pr_created',
      sessionId: 'session-123',
      prUrl: 'https://github.com/org/repo/pull/42',
    });

    expect(mockClient.updateSessionExternalUrls).toHaveBeenCalledWith({
      sessionId: 'session-123',
      externalUrls: [{ label: 'Pull Request', url: 'https://github.com/org/repo/pull/42' }],
    });
  });

  it('does not add external URL when pr_created without prUrl', async () => {
    await reporter.reportEvent({
      type: 'pr_created',
      sessionId: 'session-123',
    });

    expect(mockClient.updateSessionExternalUrls).not.toHaveBeenCalled();
  });

  it('handles emitActivity failure gracefully (non-fatal)', async () => {
    (mockClient.emitActivity as ReturnType<typeof vi.fn>).mockResolvedValue(
      err({ code: 'UNAVAILABLE', message: 'Linear API down' })
    );

    // Should not throw
    await reporter.reportEvent({
      type: 'task_dispatched',
      sessionId: 'session-123',
    });

    // Plan update should still be called
    expect(mockClient.updateSessionPlan).toHaveBeenCalled();
  });

  it('handles updateSessionPlan failure gracefully (non-fatal)', async () => {
    (mockClient.updateSessionPlan as ReturnType<typeof vi.fn>).mockResolvedValue(
      err({ code: 'UNAVAILABLE', message: 'Linear API down' })
    );

    // Should not throw
    await reporter.reportEvent({
      type: 'phase2_start',
      sessionId: 'session-123',
    });

    expect(mockClient.emitActivity).toHaveBeenCalled();
  });

  it('handles updateSessionExternalUrls failure gracefully', async () => {
    (mockClient.updateSessionExternalUrls as ReturnType<typeof vi.fn>).mockResolvedValue(
      err({ code: 'UNAVAILABLE', message: 'Linear API down' })
    );

    // Should not throw
    await reporter.reportEvent({
      type: 'pr_created',
      sessionId: 'session-123',
      prUrl: 'https://github.com/org/repo/pull/42',
    });
  });

  it('handles unexpected errors gracefully', async () => {
    (mockClient.emitActivity as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Network error')
    );

    // Should not throw
    await reporter.reportEvent({
      type: 'task_dispatched',
      sessionId: 'session-123',
    });
  });

  it('reports task_error with details', async () => {
    await reporter.reportEvent({
      type: 'task_error',
      sessionId: 'session-123',
      details: 'CI failed: 3 tests failed',
    });

    expect(mockClient.emitActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        body: 'CI failed: 3 tests failed',
      })
    );
  });
});
