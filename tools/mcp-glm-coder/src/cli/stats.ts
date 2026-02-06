#!/usr/bin/env node

import { loadMetrics, loadPostHocEvents, getMetricsFile } from '../metrics/collector.js';
import type { GLMCallMetrics } from '../types.js';

function groupBy<T>(items: T[], keyFn: (item: T) => string): Record<string, T[]> {
  const result: Record<string, T[]> = {};
  for (const item of items) {
    const key = keyFn(item);
    if (!result[key]) {
      result[key] = [];
    }
    result[key].push(item);
  }
  return result;
}

function calculatePercentile(values: number[], percentile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((percentile / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)] ?? 0;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function generateReport(metrics: GLMCallMetrics[], postHocEdits: Set<string>): void {
  if (metrics.length === 0) {
    console.log('No metrics recorded yet.');
    console.log(`Metrics file: ${getMetricsFile()}`);
    return;
  }

  const total = metrics.length;
  const successful = metrics.filter((m) => m.finalSuccess).length;
  const firstAttemptSuccess = metrics.filter((m) => m.attempts[0]?.success).length;
  const avgAttempts = metrics.reduce((sum, m) => sum + m.attempts.length, 0) / total;
  const latencies = metrics.map((m) => m.totalLatencyMs);
  const avgLatency = latencies.reduce((a, b) => a + b, 0) / total;
  const p50Latency = calculatePercentile(latencies, 50);
  const p95Latency = calculatePercentile(latencies, 95);

  const manualEditsCount = metrics.filter((m) => postHocEdits.has(m.id)).length;

  const byTaskType = groupBy(metrics, (m) => m.taskType);
  const errorCategories = metrics
    .filter((m) => !m.finalSuccess)
    .flatMap((m) => m.validationErrors)
    .reduce(
      (acc, err) => {
        const category = categorizeErrorString(err);
        acc[category] = (acc[category] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

  const firstDate = metrics[0]?.timestamp.slice(0, 10) ?? 'N/A';
  const lastDate = metrics[total - 1]?.timestamp.slice(0, 10) ?? 'N/A';

  console.log(`
╔══════════════════════════════════════════════════════════════╗
║                   GLM Coder Metrics Report                   ║
╠══════════════════════════════════════════════════════════════╣
║ Period: ${firstDate} → ${lastDate.padEnd(42)}║
║ Total Calls: ${String(total).padEnd(47)}║
╠══════════════════════════════════════════════════════════════╣
║ SUCCESS RATES                                                ║
╟──────────────────────────────────────────────────────────────╢
║ Final Success Rate:        ${((successful / total) * 100).toFixed(1).padStart(5)}%                            ║
║ First-Attempt Success:     ${((firstAttemptSuccess / total) * 100).toFixed(1).padStart(5)}%                            ║
║ Average Attempts:          ${avgAttempts.toFixed(2).padStart(5)}                             ║
║ Manual Edits Required:     ${((manualEditsCount / total) * 100).toFixed(1).padStart(5)}%                            ║
╠══════════════════════════════════════════════════════════════╣
║ PERFORMANCE                                                  ║
╟──────────────────────────────────────────────────────────────╢
║ Average Latency:           ${formatDuration(avgLatency).padEnd(32)}║
║ P50 Latency:               ${formatDuration(p50Latency).padEnd(32)}║
║ P95 Latency:               ${formatDuration(p95Latency).padEnd(32)}║
╠══════════════════════════════════════════════════════════════╣
║ BY TASK TYPE                                                 ║
╟──────────────────────────────────────────────────────────────╢`);

  for (const [taskType, items] of Object.entries(byTaskType)) {
    const successRate = (items.filter((i) => i.finalSuccess).length / items.length) * 100;
    console.log(
      `║ ${taskType.padEnd(25)} ${String(items.length).padStart(3)} calls, ${successRate.toFixed(0).padStart(3)}% success    ║`
    );
  }

  console.log(`╠══════════════════════════════════════════════════════════════╣
║ TOP ERROR CATEGORIES                                         ║
╟──────────────────────────────────────────────────────────────╢`);

  const sortedErrors = Object.entries(errorCategories)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  if (sortedErrors.length === 0) {
    console.log(`║ (no errors recorded)                                         ║`);
  } else {
    for (const [category, count] of sortedErrors) {
      console.log(
        `║ ${category.padEnd(25)} ${String(count).padStart(3)} occurrences             ║`
      );
    }
  }

  console.log(`╠══════════════════════════════════════════════════════════════╣
║ RECENT CALLS                                                 ║
╟──────────────────────────────────────────────────────────────╢`);

  const recent = metrics.slice(-5);
  for (const m of recent) {
    const status = m.finalSuccess ? '✓' : '✗';
    const time = m.timestamp.slice(5, 16).replace('T', ' ');
    const desc = m.taskDescription.slice(0, 30).padEnd(30);
    console.log(`║ ${time} ${status} ${String(m.attempts.length).padStart(1)}att ${desc}  ║`);
  }

  console.log(`╚══════════════════════════════════════════════════════════════╝`);
  console.log(`\nMetrics file: ${getMetricsFile()}`);
}

function categorizeErrorString(error: string): string {
  if (error.includes('TS2322') || error.includes('TS2345') || error.includes('TS2339')) {
    return 'type-mismatch';
  }
  if (error.includes('TS2307') || error.includes('TS2305')) {
    return 'import-error';
  }
  if (error.includes('TS1005') || error.includes('TS1003')) {
    return 'syntax-error';
  }
  if (error.includes('TS2532') || error.includes('TS18048')) {
    return 'strict-null';
  }
  if (error.includes('Unbalanced')) {
    return 'syntax-error';
  }
  return 'other';
}

function main(): void {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
GLM Coder Statistics CLI

Usage: glm-stats [options]

Options:
  --help, -h     Show this help message
  --json         Output raw metrics as JSON
  --recent N     Show only the last N calls (default: all)
  --since DATE   Show only calls since DATE (YYYY-MM-DD)

Examples:
  glm-stats                  # Show full report
  glm-stats --recent 10      # Show stats for last 10 calls
  glm-stats --json           # Export as JSON
`);
    return;
  }

  let metrics = loadMetrics();
  const postHocEvents = loadPostHocEvents();
  const postHocEdits = new Set(postHocEvents.map((e) => e.callId));

  const recentIndex = args.indexOf('--recent');
  if (recentIndex !== -1 && args[recentIndex + 1]) {
    const n = parseInt(args[recentIndex + 1], 10);
    if (!isNaN(n) && n > 0) {
      metrics = metrics.slice(-n);
    }
  }

  const sinceIndex = args.indexOf('--since');
  if (sinceIndex !== -1 && args[sinceIndex + 1]) {
    const sinceDate = args[sinceIndex + 1];
    metrics = metrics.filter((m) => m.timestamp >= sinceDate);
  }

  if (args.includes('--json')) {
    console.log(JSON.stringify(metrics, null, 2));
    return;
  }

  generateReport(metrics, postHocEdits);
}

main();
