import { describe, it, expect } from 'vitest';
import { formatMetricsLogLines } from '../domain/formatters/metricsLogFormatter.js';
import type { TurnMetrics } from '../domain/models/turnMetrics.js';

describe('metricsLogFormatter', () => {
  const baseMetrics: TurnMetrics = {
    taskId: 'test-task',
    attempt: 1,
    timestamp: '2024-01-01T00:00:00Z',
    cpuTimeSeconds: 10,
    cpuCores: 4,
    peakMemoryMB: 1024,
    wallTimeSeconds: 60,
    apiWaitSeconds: 20,
    toolExecSeconds: 15,
    backgroundWaitSeconds: 5,
    overheadSeconds: 5,
    totalInputTokens: 1000,
    totalOutputTokens: 500,
    totalCacheReadTokens: 200,
    totalCacheCreationTokens: 100,
    apiCallCount: 10,
    cpuUtilizationPercent: 50,
    idlePercent: 25,
  };

  describe('formatMetricsLogLines', () => {
    it('formats normal metrics correctly', () => {
      const result = formatMetricsLogLines(baseMetrics);
      expect(result).toBeDefined();
      expect(result.length).toBeGreaterThan(0);
      // TURN METRICS is on line 2 (index 1)
      expect(result.some((line) => line.includes('TURN METRICS'))).toBe(true);
    });

    it('handles zero cpuCores (block 1)', () => {
      const zeroCpuMetrics: TurnMetrics = {
        ...baseMetrics,
        cpuCores: 0,
        cpuUtilizationPercent: 0,
      };
      const result = formatMetricsLogLines(zeroCpuMetrics);
      expect(result).toBeDefined();
      // Should not throw and should handle zero cpuCores gracefully
      expect(result.some((line) => line.includes('0%/core'))).toBe(true);
    });

    it('handles zero wallTimeSeconds (block 2)', () => {
      const zeroWallMetrics: TurnMetrics = {
        ...baseMetrics,
        wallTimeSeconds: 0,
        apiWaitSeconds: 0,
        toolExecSeconds: 0,
        backgroundWaitSeconds: 0,
        overheadSeconds: 0,
      };
      const result = formatMetricsLogLines(zeroWallMetrics);
      expect(result).toBeDefined();
      // Should not throw and should handle zero wallTimeSeconds gracefully
    });

    it('handles all-zero token metrics (blocks 3 & 4)', () => {
      const zeroTokenMetrics: TurnMetrics = {
        ...baseMetrics,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCacheReadTokens: 0,
        totalCacheCreationTokens: 0,
      };
      const result = formatMetricsLogLines(zeroTokenMetrics);
      expect(result).toBeDefined();
      // Should show 0% cache hit rate when all tokens are zero
      expect(result.some((line) => line.includes('Cache hit: 0.0%'))).toBe(true);
    });

    it('handles all-zero metrics (covers all 4 blocks)', () => {
      const allZeroMetrics: TurnMetrics = {
        taskId: 'test-task',
        attempt: 1,
        timestamp: '2024-01-01T00:00:00Z',
        cpuTimeSeconds: 0,
        cpuCores: 0,
        peakMemoryMB: 0,
        wallTimeSeconds: 0,
        apiWaitSeconds: 0,
        toolExecSeconds: 0,
        backgroundWaitSeconds: 0,
        overheadSeconds: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCacheReadTokens: 0,
        totalCacheCreationTokens: 0,
        apiCallCount: 0,
        cpuUtilizationPercent: 0,
        idlePercent: 100,
      };
      const result = formatMetricsLogLines(allZeroMetrics);
      expect(result).toBeDefined();
      expect(result.length).toBeGreaterThan(0);
      // Verify output contains expected structure - TURN METRICS is on line 2 (index 1)
      expect(result.some((line) => line.includes('TURN METRICS'))).toBe(true);
    });
  });
});
