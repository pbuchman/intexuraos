/**
 * Surface tests for `@intexuraos/common-metrics`.
 *
 * Asserts the public exports are present and that the
 * `CODE_TASK_METRICS` descriptor literals match the documented spec.
 */

import { describe, expect, it } from 'vitest';
import * as surface from '../index.js';

describe('@intexuraos/common-metrics surface', () => {
  it('exposes createMetricsClient and CODE_TASK_METRICS', () => {
    expect(typeof surface.createMetricsClient).toBe('function');
    expect(surface.CODE_TASK_METRICS).toBeDefined();
  });

  it('CODE_TASK_METRICS.COMPLETED matches the documented descriptor', () => {
    expect(surface.CODE_TASK_METRICS.COMPLETED).toEqual({
      name: 'code_tasks_completed',
      type: 'counter',
      unit: '1',
      description: 'Number of code tasks that completed successfully',
    });
  });

  it('CODE_TASK_METRICS.FAILED matches the documented descriptor', () => {
    expect(surface.CODE_TASK_METRICS.FAILED).toEqual({
      name: 'code_tasks_failed',
      type: 'counter',
      unit: '1',
      description: 'Number of code tasks that ended in failure',
    });
  });

  it('CODE_TASK_METRICS.DURATION matches the documented descriptor', () => {
    expect(surface.CODE_TASK_METRICS.DURATION).toEqual({
      name: 'code_task_duration',
      type: 'distribution',
      unit: 'ms',
      description: 'Duration of code task lifecycle in milliseconds',
    });
  });
});
