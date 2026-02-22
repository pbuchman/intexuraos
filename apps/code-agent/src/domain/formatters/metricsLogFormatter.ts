import type { TurnMetrics } from '../models/turnMetrics.js';

function fmtDuration(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  if (mins < 60) return `${String(mins)}m ${String(secs)}s`;
  const hrs = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return `${String(hrs)}h ${String(remainMins)}m`;
}

function fmtNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function bar(pct: number, width: number): string {
  const clamped = Math.max(0, Math.min(100, pct));
  const filled = Math.round((clamped / 100) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

export function formatMetricsLogLines(m: TurnMetrics): string[] {
  const lines: string[] = [];
  const w = 60;
  const h = '─'.repeat(w);

  lines.push(`[system] ┌${h}┐`);
  lines.push(`[system] │ TURN METRICS  attempt ${String(m.attempt).padStart(3)}${' '.repeat(w - 28)}│`);
  lines.push(`[system] ├${h}┤`);

  const cpuLabel = m.cpuCores % 1 === 0 ? String(m.cpuCores) : m.cpuCores.toFixed(1);
  const cpuLine = `CPU  ${m.cpuUtilizationPercent.toFixed(1)}% of ${cpuLabel} cores (${fmtDuration(m.cpuTimeSeconds)} used)`;
  lines.push(`[system] │ ${cpuLine.padEnd(w - 2)}│`);

  const cpuPctPerCore = m.cpuCores > 0 ? m.cpuUtilizationPercent / m.cpuCores : 0;
  const cpuBar = `${bar(cpuPctPerCore, 40)} ${cpuPctPerCore.toFixed(0)}%/core`;
  lines.push(`[system] │ ${cpuBar.padEnd(w - 2)}│`);

  const memGB = m.peakMemoryMB / 1024;
  const memLine = `MEM  ${memGB.toFixed(1)} GB peak`;
  lines.push(`[system] │ ${memLine.padEnd(w - 2)}│`);

  lines.push(`[system] ├${h}┤`);

  const wallLine = `Wall time: ${fmtDuration(m.wallTimeSeconds)}`;
  lines.push(`[system] │ ${wallLine.padEnd(w - 2)}│`);

  const total = m.wallTimeSeconds || 1;
  const timeEntries = [
    { label: 'API Wait', seconds: m.apiWaitSeconds, pct: (m.apiWaitSeconds / total) * 100 },
    { label: 'Overhead', seconds: m.overheadSeconds, pct: (m.overheadSeconds / total) * 100 },
  ];

  if (m.toolExecSeconds <= m.wallTimeSeconds * 2) {
    timeEntries.splice(1, 0, {
      label: 'Tool Exec',
      seconds: m.toolExecSeconds,
      pct: (m.toolExecSeconds / total) * 100,
    });
  }

  if (m.backgroundWaitSeconds > 0) {
    timeEntries.push({
      label: 'BG Wait',
      seconds: m.backgroundWaitSeconds,
      pct: (m.backgroundWaitSeconds / total) * 100,
    });
  }

  for (const entry of timeEntries) {
    const entryLine = `  ${entry.label.padEnd(11)} ${fmtDuration(entry.seconds).padStart(8)}  ${entry.pct.toFixed(1).padStart(5)}%`;
    lines.push(`[system] │ ${entryLine.padEnd(w - 2)}│`);
  }

  if (m.toolExecSeconds > m.wallTimeSeconds * 2) {
    const anomaly = `  ⚠ Tool Exec ${fmtDuration(m.toolExecSeconds)} (${(m.toolExecSeconds / m.wallTimeSeconds).toFixed(0)}x wall — anomalous)`;
    lines.push(`[system] │ ${anomaly.padEnd(w - 2)}│`);
  }

  const idleLine = `Idle: ${m.idlePercent.toFixed(1)}%`;
  lines.push(`[system] │ ${idleLine.padEnd(w - 2)}│`);

  lines.push(`[system] ├${h}┤`);

  const apiLine = `API calls: ${String(m.apiCallCount)}`;
  lines.push(`[system] │ ${apiLine.padEnd(w - 2)}│`);

  const tokenEntries = [
    { label: 'Input', value: m.totalInputTokens },
    { label: 'Output', value: m.totalOutputTokens },
    { label: 'Cache Read', value: m.totalCacheReadTokens },
    { label: 'Cache Create', value: m.totalCacheCreationTokens },
  ];

  const maxTokens = Math.max(...tokenEntries.map((e) => e.value));
  const tokenBarWidth = 30;

  for (const entry of tokenEntries) {
    const pct = maxTokens > 0 ? (entry.value / maxTokens) * 100 : 0;
    const tokenBar = bar(pct, tokenBarWidth);
    const tokenLine = `  ${entry.label.padEnd(13)} ${fmtNumber(entry.value).padStart(7)} ${tokenBar}`;
    lines.push(`[system] │ ${tokenLine.padEnd(w - 2)}│`);
  }

  const totalTokens = m.totalInputTokens + m.totalOutputTokens + m.totalCacheReadTokens + m.totalCacheCreationTokens;
  const cacheHitRate = totalTokens > 0 ? (m.totalCacheReadTokens / totalTokens) * 100 : 0;
  const totalLine = `Total: ${fmtNumber(totalTokens)}  Cache hit: ${cacheHitRate.toFixed(1)}%`;
  lines.push(`[system] │ ${totalLine.padEnd(w - 2)}│`);

  lines.push(`[system] └${h}┘`);

  return lines;
}
