import { Firestore } from '@google-cloud/firestore';
import type { TurnMetrics } from '../services/turn-metrics-collector.js';

/* v8 ignore start -- module-init: standalone CLI entry point, not reachable from test imports @preserve */
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const MAGENTA = '\x1b[35m';
const BLUE = '\x1b[34m';
const WHITE = '\x1b[37m';
const BG_CYAN = '\x1b[46m';
const BG_YELLOW = '\x1b[43m';
const BG_MAGENTA = '\x1b[45m';
const BG_BLUE = '\x1b[44m';

const BAR_FULL = '█';
const BAR_SEVEN = '▉';
const BAR_SIX = '▊';
const BAR_FIVE = '▋';
const BAR_FOUR = '▌';
const BAR_THREE = '▍';
const BAR_TWO = '▎';
const BAR_ONE = '▏';
const BAR_EMPTY = '░';

const BOX_TL = '╭';
const BOX_TR = '╮';
const BOX_BL = '╰';
const BOX_BR = '╯';
const BOX_H = '─';
const BOX_V = '│';

function bar(pct: number, width: number, color: string): string {
  const clamped = Math.max(0, Math.min(100, pct));
  const filled = (clamped / 100) * width;
  const fullBlocks = Math.floor(filled);
  const remainder = filled - fullBlocks;

  const partials = [
    ' ',
    BAR_ONE,
    BAR_TWO,
    BAR_THREE,
    BAR_FOUR,
    BAR_FIVE,
    BAR_SIX,
    BAR_SEVEN,
    BAR_FULL,
  ];
  const partialIdx = Math.round(remainder * 8);
  const partialChar = partials[partialIdx] ?? ' ';

  const emptyBlocks = width - fullBlocks - (partialIdx > 0 ? 1 : 0);

  return (
    color +
    BAR_FULL.repeat(fullBlocks) +
    (partialIdx > 0 ? partialChar : '') +
    RESET +
    DIM +
    BAR_EMPTY.repeat(Math.max(0, emptyBlocks)) +
    RESET
  );
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  if (mins < 60) return `${String(mins)}m ${String(secs)}s`;
  const hrs = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return `${String(hrs)}h ${String(remainMins)}m`;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function boxTop(width: number, title?: string): string {
  if (title !== undefined) {
    const titleStr = ` ${title} `;
    const remaining = width - 2 - titleStr.length;
    const left = Math.max(1, Math.floor(remaining / 2));
    const right = Math.max(1, remaining - left);
    return (
      DIM +
      BOX_TL +
      BOX_H.repeat(left) +
      RESET +
      BOLD +
      titleStr +
      RESET +
      DIM +
      BOX_H.repeat(right) +
      BOX_TR +
      RESET
    );
  }
  return DIM + BOX_TL + BOX_H.repeat(width - 2) + BOX_TR + RESET;
}

function boxBottom(width: number): string {
  return DIM + BOX_BL + BOX_H.repeat(width - 2) + BOX_BR + RESET;
}

function boxRow(content: string, width: number): string {
  const stripped = content.replace(/\x1b\[[0-9;]*m/g, '');
  const pad = Math.max(0, width - 4 - stripped.length);
  return DIM + BOX_V + RESET + ' ' + content + ' '.repeat(pad) + ' ' + DIM + BOX_V + RESET;
}

function renderMetrics(m: TurnMetrics, width: number): string {
  const lines: string[] = [];
  const w = width;

  lines.push('');
  lines.push(boxTop(w, `${CYAN}TURN METRICS${RESET}`));
  lines.push(boxRow(`${DIM}Task${RESET}     ${WHITE}${m.taskId}${RESET}`, w));
  lines.push(boxRow(`${DIM}Attempt${RESET}  ${WHITE}${String(m.attempt)}${RESET}`, w));
  lines.push(boxRow(`${DIM}Time${RESET}     ${WHITE}${m.timestamp}${RESET}`, w));
  lines.push(boxBottom(w));

  lines.push('');
  lines.push(boxTop(w, `${GREEN}RESOURCES${RESET}`));

  const cpuLabel = m.cpuCores % 1 === 0 ? String(m.cpuCores) : m.cpuCores.toFixed(1);
  const cpuPct = m.cpuUtilizationPercent;
  const cpuColor = cpuPct > 80 * m.cpuCores ? RED : cpuPct > 50 * m.cpuCores ? YELLOW : GREEN;
  lines.push(
    boxRow(
      `${BOLD}CPU${RESET}  ${cpuColor}${cpuPct.toFixed(1)}%${RESET} ${DIM}of ${cpuLabel} cores (${formatDuration(m.cpuTimeSeconds)} used)${RESET}`,
      w
    )
  );
  lines.push(
    boxRow(
      bar(cpuPct / m.cpuCores, w - 6, cpuColor) +
        ` ${DIM}${(cpuPct / m.cpuCores).toFixed(0)}%/core${RESET}`,
      w
    )
  );
  lines.push(boxRow('', w));

  const memGB = m.peakMemoryMB / 1024;
  const memColor = memGB > 6 ? RED : memGB > 3 ? YELLOW : GREEN;
  lines.push(
    boxRow(
      `${BOLD}MEM${RESET}  ${memColor}${memGB.toFixed(1)} GB${RESET} ${DIM}peak (${m.peakMemoryMB.toFixed(0)} MB)${RESET}`,
      w
    )
  );
  lines.push(boxBottom(w));

  lines.push('');
  lines.push(boxTop(w, `${BLUE}TIME BREAKDOWN${RESET}`));
  lines.push(
    boxRow(`${BOLD}Wall${RESET}  ${WHITE}${formatDuration(m.wallTimeSeconds)}${RESET}`, w)
  );
  lines.push(boxRow('', w));

  const total = m.wallTimeSeconds || 1;
  const apiPct = (m.apiWaitSeconds / total) * 100;
  const toolPct = (m.toolExecSeconds / total) * 100;
  const bgPct = (m.backgroundWaitSeconds / total) * 100;
  const overPct = (m.overheadSeconds / total) * 100;

  const timeBarWidth = w - 20;
  const timeEntries: Array<{
    label: string;
    seconds: number;
    pct: number;
    color: string;
    bgColor: string;
  }> = [
    { label: 'API Wait', seconds: m.apiWaitSeconds, pct: apiPct, color: BLUE, bgColor: BG_BLUE },
    {
      label: 'Tool Exec',
      seconds: m.toolExecSeconds,
      pct: toolPct,
      color: MAGENTA,
      bgColor: BG_MAGENTA,
    },
    {
      label: 'BG Wait',
      seconds: m.backgroundWaitSeconds,
      pct: bgPct,
      color: CYAN,
      bgColor: BG_CYAN,
    },
    {
      label: 'Overhead',
      seconds: m.overheadSeconds,
      pct: overPct,
      color: YELLOW,
      bgColor: BG_YELLOW,
    },
  ];

  // Stacked bar
  let stackedBar = '';
  for (const entry of timeEntries) {
    const blocks = Math.max(0, Math.round((entry.pct / 100) * timeBarWidth));
    if (blocks > 0) {
      stackedBar += entry.bgColor + WHITE + BAR_FULL.repeat(blocks) + RESET;
    }
  }
  const usedBlocks = timeEntries.reduce(
    (sum, e) => sum + Math.max(0, Math.round((e.pct / 100) * timeBarWidth)),
    0
  );
  if (usedBlocks < timeBarWidth) {
    stackedBar += DIM + BAR_EMPTY.repeat(timeBarWidth - usedBlocks) + RESET;
  }
  lines.push(boxRow(stackedBar, w));
  lines.push(boxRow('', w));

  for (const entry of timeEntries) {
    if (entry.seconds > 0) {
      const pctStr = entry.pct.toFixed(1).padStart(5);
      lines.push(
        boxRow(
          `  ${entry.color}■${RESET} ${entry.label.padEnd(10)} ${WHITE}${formatDuration(entry.seconds).padStart(8)}${RESET}  ${DIM}${pctStr}%${RESET}`,
          w
        )
      );
    }
  }

  lines.push(boxRow('', w));
  lines.push(
    boxRow(
      `${DIM}Idle${RESET} ${CYAN}${m.idlePercent.toFixed(1)}%${RESET} ${DIM}(API + BG wait)${RESET}`,
      w
    )
  );
  lines.push(boxBottom(w));

  if (m.toolExecSeconds > m.wallTimeSeconds * 2) {
    lines.push('');
    lines.push(
      `  ${RED}${BOLD}⚠${RESET}  ${YELLOW}toolExecSeconds (${formatDuration(m.toolExecSeconds)}) exceeds wall time by ${(m.toolExecSeconds / m.wallTimeSeconds).toFixed(0)}x${RESET}`
    );
    lines.push(
      `     ${DIM}Likely parallel tool durations summed without overlap correction${RESET}`
    );
  }

  lines.push('');
  lines.push(boxTop(w, `${MAGENTA}TOKENS${RESET}`));
  lines.push(boxRow(`${BOLD}API Calls${RESET}  ${WHITE}${String(m.apiCallCount)}${RESET}`, w));
  lines.push(boxRow('', w));

  const tokenEntries: Array<{ label: string; value: number; color: string }> = [
    { label: 'Input', value: m.totalInputTokens, color: WHITE },
    { label: 'Output', value: m.totalOutputTokens, color: GREEN },
    { label: 'Cache Read', value: m.totalCacheReadTokens, color: BLUE },
    { label: 'Cache Create', value: m.totalCacheCreationTokens, color: MAGENTA },
  ];

  const maxTokens = Math.max(...tokenEntries.map((e) => e.value));
  const tokenBarWidth = w - 30;

  for (const entry of tokenEntries) {
    const pct = maxTokens > 0 ? (entry.value / maxTokens) * 100 : 0;
    const blocks = Math.max(0, Math.round((pct / 100) * tokenBarWidth));
    const tokenBar =
      entry.color +
      BAR_FULL.repeat(blocks) +
      RESET +
      DIM +
      BAR_EMPTY.repeat(tokenBarWidth - blocks) +
      RESET;
    lines.push(
      boxRow(
        `  ${entry.label.padEnd(13)} ${entry.color}${formatNumber(entry.value).padStart(7)}${RESET} ${tokenBar}`,
        w
      )
    );
  }

  const totalTokens =
    m.totalInputTokens + m.totalOutputTokens + m.totalCacheReadTokens + m.totalCacheCreationTokens;
  const cacheHitRate = totalTokens > 0 ? (m.totalCacheReadTokens / totalTokens) * 100 : 0;

  lines.push(boxRow('', w));
  lines.push(
    boxRow(
      `${DIM}Total${RESET}  ${WHITE}${formatNumber(totalTokens)}${RESET}  ${DIM}│${RESET}  ${DIM}Cache hit rate${RESET} ${CYAN}${cacheHitRate.toFixed(1)}%${RESET}`,
      w
    )
  );
  lines.push(boxBottom(w));

  lines.push('');

  return lines.join('\n');
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

async function fetchFromFirestore(taskId: string): Promise<TurnMetrics[]> {
  const projectId = process.env['INTEXURAOS_GCP_PROJECT_ID'] ?? 'intexuraos-dev-pbuchman';
  const db = new Firestore({ projectId });
  const snap = await db
    .collection('code_tasks')
    .doc(taskId)
    .collection('turn_metrics')
    .orderBy('attempt')
    .get();
  return snap.docs.map((doc) => doc.data() as TurnMetrics);
}

async function main(): Promise<void> {
  const width = Math.min(process.stdout.columns || 80, 90);

  if (!process.stdin.isTTY) {
    const input = await readStdin();
    const metrics = JSON.parse(input) as TurnMetrics | TurnMetrics[];
    const list = Array.isArray(metrics) ? metrics : [metrics];
    for (const m of list) {
      console.log(renderMetrics(m, width));
    }
    return;
  }

  const taskId = process.argv[2];
  if (taskId === undefined) {
    console.error('Usage: npx tsx src/scripts/view-metrics.ts <taskId>');
    console.error('   or: echo \'{"taskId":...}\' | npx tsx src/scripts/view-metrics.ts');
    process.exit(1);
  }

  const metrics = await fetchFromFirestore(taskId);
  if (metrics.length === 0) {
    console.log(`${DIM}No turn metrics found for ${taskId}${RESET}`);
    process.exit(0);
  }

  for (const m of metrics) {
    console.log(renderMetrics(m, width));
  }
}

main().catch((err: unknown) => {
  console.error('Error:', err);
  process.exit(1);
});
/* v8 ignore stop @preserve */
