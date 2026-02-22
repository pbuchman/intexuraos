import { describe, it, expect } from 'vitest';
import { formatMetricsLogLines } from '../../domain/formatters/metricsLogFormatter.js';
import type { TurnMetrics } from '../../domain/models/turnMetrics.js';

describe('formatMetricsLogLines', () => {
  const baseMetrics: TurnMetrics = {
    taskId: 'task_abc123',
    attempt: 1,
    timestamp: '2026-02-21T22:48:57.404Z',
    cpuTimeSeconds: 2544,
    cpuCores: 2,
    peakMemoryMB: 7087,
    wallTimeSeconds: 661,
    apiWaitSeconds: 415,
    toolExecSeconds: 456134,
    backgroundWaitSeconds: 0,
    overheadSeconds: 38,
    totalInputTokens: 142,
    totalOutputTokens: 1509,
    totalCacheReadTokens: 5360194,
    totalCacheCreationTokens: 548946,
    apiCallCount: 110,
    cpuUtilizationPercent: 192.28,
    idlePercent: 62.73,
  };

  it('returns array of [system]-prefixed lines', () => {
    const lines = formatMetricsLogLines(baseMetrics);

    expect(lines.length).toBeGreaterThan(10);
    for (const line of lines) {
      expect(line).toMatch(/^\[system\] /);
    }
  });

  it('includes CPU utilization and cores', () => {
    const lines = formatMetricsLogLines(baseMetrics);
    const cpuLine = lines.find((l) => l.includes('192.'));

    expect(cpuLine).toBeDefined();
    expect(cpuLine).toContain('2 cores');
  });

  it('includes memory peak', () => {
    const lines = formatMetricsLogLines(baseMetrics);
    const memLine = lines.find((l) => l.includes('MEM'));

    expect(memLine).toBeDefined();
    expect(memLine).toContain('6.9 GB');
  });

  it('includes wall time', () => {
    const lines = formatMetricsLogLines(baseMetrics);
    const wallLine = lines.find((l) => l.includes('Wall time'));

    expect(wallLine).toBeDefined();
    expect(wallLine).toContain('11m');
  });

  it('flags toolExecSeconds anomaly when > 2x wall time', () => {
    const lines = formatMetricsLogLines(baseMetrics);
    const anomalyLine = lines.find((l) => l.includes('anomalous'));

    expect(anomalyLine).toBeDefined();
  });

  it('shows toolExecSeconds normally when within 2x wall time', () => {
    const normal: TurnMetrics = {
      ...baseMetrics,
      toolExecSeconds: 200,
    };
    const lines = formatMetricsLogLines(normal);
    const toolLine = lines.find((l) => l.includes('Tool Exec'));
    const anomalyLine = lines.find((l) => l.includes('anomalous'));

    expect(toolLine).toBeDefined();
    expect(anomalyLine).toBeUndefined();
  });

  it('includes token counts', () => {
    const lines = formatMetricsLogLines(baseMetrics);
    const cacheLine = lines.find((l) => l.includes('Cache Read'));

    expect(cacheLine).toBeDefined();
    expect(cacheLine).toContain('5.4M');
  });

  it('includes cache hit rate', () => {
    const lines = formatMetricsLogLines(baseMetrics);
    const totalLine = lines.find((l) => l.includes('Cache hit'));

    expect(totalLine).toBeDefined();
    expect(totalLine).toContain('90.');
  });

  it('includes API call count', () => {
    const lines = formatMetricsLogLines(baseMetrics);
    const apiLine = lines.find((l) => l.includes('API calls'));

    expect(apiLine).toBeDefined();
    expect(apiLine).toContain('110');
  });

  it('includes background wait when > 0', () => {
    const withBg: TurnMetrics = {
      ...baseMetrics,
      backgroundWaitSeconds: 30,
    };
    const lines = formatMetricsLogLines(withBg);
    const bgLine = lines.find((l) => l.includes('BG Wait'));

    expect(bgLine).toBeDefined();
  });

  it('omits background wait when 0', () => {
    const lines = formatMetricsLogLines(baseMetrics);
    const bgLine = lines.find((l) => l.includes('BG Wait'));

    expect(bgLine).toBeUndefined();
  });

  it('has box-drawing borders on first and last line', () => {
    const lines = formatMetricsLogLines(baseMetrics);

    expect(lines[0]).toContain('┌');
    expect(lines[lines.length - 1]).toContain('┘');
  });

  it('handles fractional cpu cores', () => {
    const fractional: TurnMetrics = {
      ...baseMetrics,
      cpuCores: 0.5,
      cpuUtilizationPercent: 45,
    };
    const lines = formatMetricsLogLines(fractional);
    const cpuLine = lines.find((l) => l.includes('0.5 cores'));

    expect(cpuLine).toBeDefined();
  });
});
