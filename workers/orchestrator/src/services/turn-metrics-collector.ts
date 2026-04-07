import { readFile } from 'node:fs/promises';
import { glob } from 'node:fs/promises';
import { createHmac } from 'node:crypto';
import { join } from 'node:path';
import { availableParallelism } from 'node:os';
import type { Logger } from '@intexuraos/common-core';

export interface TurnMetrics {
  taskId: string;
  attempt: number;
  timestamp: string;
  // Resource (cgroup)
  cpuTimeSeconds: number;
  cpuCores: number;
  peakMemoryMB: number;
  // Time classification (session JSONL)
  wallTimeSeconds: number;
  apiWaitSeconds: number;
  toolExecSeconds: number;
  backgroundWaitSeconds: number;
  overheadSeconds: number;
  // Tokens (session JSONL)
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheCreationTokens: number;
  apiCallCount: number;
  // Derived
  cpuUtilizationPercent: number;
  idlePercent: number;
}

export interface TurnMetricsCollectorConfig {
  codeAgentUrl: string;
  orchestratorSecret: string;
  internalAuthToken: string;
  secretsBasePath: string;
  sharedCredsPath?: string;
}

interface SessionEntry {
  type: string;
  timestamp?: string;
  subtype?: string;
  message?: {
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
  };
}

interface TimeClassification {
  wallTimeSeconds: number;
  apiWaitSeconds: number;
  toolExecSeconds: number;
  backgroundWaitSeconds: number;
  overheadSeconds: number;
}

interface TokenAggregation {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheCreationTokens: number;
  apiCallCount: number;
}

export class TurnMetricsCollector {
  constructor(
    private readonly config: TurnMetricsCollectorConfig,
    private readonly logger: Logger
  ) {}

  async collectAndPublish(params: {
    taskId: string;
    containerId: string;
    attempt: number;
    startedAt: string;
    completedAt: string;
  }): Promise<void> {
    try {
      const cgroupPath = `/sys/fs/cgroup/system.slice/docker-${params.containerId}.scope`;

      const [cpuTimeSeconds, peakMemoryMB, cpuCores, sessionData] = await Promise.all([
        this.readCpuTimeSec(cgroupPath),
        this.readPeakMemoryMB(cgroupPath),
        this.readCpuCores(cgroupPath),
        this.parseSessionJsonl(params.taskId, {
          startedAt: params.startedAt,
          completedAt: params.completedAt,
        }),
      ]);

      const wallTimeSeconds =
        (new Date(params.completedAt).getTime() - new Date(params.startedAt).getTime()) / 1000;

      const timeClassification = sessionData.timeClassification;
      const tokens = sessionData.tokens;

      const cpuUtilizationPercent =
        wallTimeSeconds > 0 ? (cpuTimeSeconds / (wallTimeSeconds * cpuCores)) * 100 : 0;
      const idlePercent =
        wallTimeSeconds > 0
          ? ((timeClassification.apiWaitSeconds + timeClassification.backgroundWaitSeconds) /
              wallTimeSeconds) *
            100
          : 0;

      const metrics: TurnMetrics = {
        taskId: params.taskId,
        attempt: params.attempt,
        timestamp: params.completedAt,
        cpuTimeSeconds,
        cpuCores,
        peakMemoryMB,
        wallTimeSeconds,
        apiWaitSeconds: timeClassification.apiWaitSeconds,
        toolExecSeconds: timeClassification.toolExecSeconds,
        backgroundWaitSeconds: timeClassification.backgroundWaitSeconds,
        overheadSeconds: timeClassification.overheadSeconds,
        totalInputTokens: tokens.totalInputTokens,
        totalOutputTokens: tokens.totalOutputTokens,
        totalCacheReadTokens: tokens.totalCacheReadTokens,
        totalCacheCreationTokens: tokens.totalCacheCreationTokens,
        apiCallCount: tokens.apiCallCount,
        cpuUtilizationPercent: Math.round(cpuUtilizationPercent * 100) / 100,
        idlePercent: Math.round(idlePercent * 100) / 100,
      };

      await this.publish(metrics);

      this.logger.info(
        {
          taskId: params.taskId,
          attempt: params.attempt,
          wallTimeSeconds: metrics.wallTimeSeconds,
          cpuUtilizationPercent: metrics.cpuUtilizationPercent,
          idlePercent: metrics.idlePercent,
          apiCallCount: metrics.apiCallCount,
        },
        'Turn metrics collected and published'
      );
    } catch (error) {
      this.logger.error(
        { taskId: params.taskId, error },
        'Failed to collect/publish turn metrics (non-fatal)'
      );
    }
  }

  async readCpuTimeSec(cgroupPath: string): Promise<number> {
    try {
      const content = await readFile(join(cgroupPath, 'cpu.stat'), 'utf-8');
      const match = /^usage_usec\s+(\d+)$/m.exec(content);
      if (match?.[1] !== undefined) {
        return parseInt(match[1], 10) / 1_000_000;
      }
      return 0;
    } catch {
      return 0;
    }
  }

  async readPeakMemoryMB(cgroupPath: string): Promise<number> {
    try {
      const content = await readFile(join(cgroupPath, 'memory.peak'), 'utf-8');
      return parseInt(content.trim(), 10) / (1024 * 1024);
    } catch {
      try {
        const content = await readFile(join(cgroupPath, 'memory.current'), 'utf-8');
        return parseInt(content.trim(), 10) / (1024 * 1024);
      } catch {
        return 0;
      }
    }
  }

  async readCpuCores(cgroupPath: string): Promise<number> {
    try {
      const content = await readFile(join(cgroupPath, 'cpu.max'), 'utf-8');
      const match = /^(\S+)\s+(\d+)$/m.exec(content.trim());
      if (match?.[1] !== undefined && match[2] !== undefined) {
        if (match[1] === 'max') {
          return availableParallelism();
        }
        const quota = parseInt(match[1], 10);
        const period = parseInt(match[2], 10);
        if (period > 0) {
          return quota / period;
        }
      }
      return availableParallelism();
    } catch {
      return availableParallelism();
    }
  }

  async parseSessionJsonl(
    taskId: string,
    _timeWindow?: { startedAt: string; completedAt: string }
  ): Promise<{ timeClassification: TimeClassification; tokens: TokenAggregation }> {
    const entries: SessionEntry[] = [];
    const basePath = join(this.config.secretsBasePath, `claude-session-${taskId}`);
    const pattern = join(basePath, 'projects', '**', '*.jsonl');

    try {
      for await (const filePath of glob(pattern)) {
        const content = await readFile(filePath, 'utf-8');

        for (const line of content.split('\n')) {
          if (line.trim() === '') continue;
          try {
            entries.push(JSON.parse(line) as SessionEntry);
          } catch {
            // Skip malformed lines
          }
        }
      }
    } catch {
      // Glob or read failure — return zero defaults
    }

    return {
      timeClassification: this.classifyTime(entries),
      tokens: this.aggregateTokens(entries),
    };
  }

  classifyTime(entries: SessionEntry[]): TimeClassification {
    let apiWaitSeconds = 0;
    let toolExecSeconds = 0;
    let backgroundWaitSeconds = 0;
    let overheadSeconds = 0;

    const timestamped = entries.filter(
      (e): e is SessionEntry & { timestamp: string } => e.timestamp !== undefined
    );

    if (timestamped.length < 2) {
      return {
        wallTimeSeconds: 0,
        apiWaitSeconds: 0,
        toolExecSeconds: 0,
        backgroundWaitSeconds: 0,
        overheadSeconds: 0,
      };
    }

    const first = timestamped[0];
    const last = timestamped[timestamped.length - 1];
    /* v8 ignore start -- ts-type: length >= 2 guarantees both exist @preserve */
    if (first === undefined || last === undefined) {
      return {
        wallTimeSeconds: 0,
        apiWaitSeconds: 0,
        toolExecSeconds: 0,
        backgroundWaitSeconds: 0,
        overheadSeconds: 0,
      };
    }
    /* v8 ignore stop @preserve */
    const firstTs = new Date(first.timestamp).getTime();
    const lastTs = new Date(last.timestamp).getTime();
    const wallTimeSeconds = (lastTs - firstTs) / 1000;

    for (let i = 0; i < timestamped.length - 1; i++) {
      const current = timestamped[i];
      const next = timestamped[i + 1];
      /* v8 ignore start -- ts-type: noUncheckedIndexedAccess undefined check; loop bounds guarantee i and i+1 are valid @preserve */
      if (current === undefined || next === undefined) continue;
      /* v8 ignore stop @preserve */
      const gapSec =
        (new Date(next.timestamp).getTime() - new Date(current.timestamp).getTime()) / 1000;

      if (gapSec <= 0) continue;

      // user -> assistant = API wait (waiting for Anthropic response)
      if (current.type === 'user' && next.type === 'assistant') {
        apiWaitSeconds += gapSec;
      }
      // assistant -> user = tool execution (Claude ran a tool, result came back)
      else if (current.type === 'assistant' && next.type === 'user') {
        toolExecSeconds += gapSec;
      }
      // progress or queue-operation = background wait
      else if (current.subtype === 'progress' || current.subtype === 'queue-operation') {
        backgroundWaitSeconds += gapSec;
      } else {
        overheadSeconds += gapSec;
      }
    }

    return {
      wallTimeSeconds,
      apiWaitSeconds,
      toolExecSeconds,
      backgroundWaitSeconds,
      overheadSeconds,
    };
  }

  aggregateTokens(entries: SessionEntry[]): TokenAggregation {
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCacheReadTokens = 0;
    let totalCacheCreationTokens = 0;
    let apiCallCount = 0;

    for (const entry of entries) {
      const usage = entry.message?.usage;
      if (usage !== undefined) {
        apiCallCount++;
        totalInputTokens += usage.input_tokens ?? 0;
        totalOutputTokens += usage.output_tokens ?? 0;
        totalCacheReadTokens += usage.cache_read_input_tokens ?? 0;
        totalCacheCreationTokens += usage.cache_creation_input_tokens ?? 0;
      }
    }

    return {
      totalInputTokens,
      totalOutputTokens,
      totalCacheReadTokens,
      totalCacheCreationTokens,
      apiCallCount,
    };
  }

  private async publish(metrics: TurnMetrics): Promise<void> {
    const body = JSON.stringify(metrics);
    const timestamp = Math.floor(Date.now() / 1000);
    const message = `${String(timestamp)}.${body}`;
    const signature = createHmac('sha256', this.config.orchestratorSecret)
      .update(message)
      .digest('hex');

    const url = `${this.config.codeAgentUrl}/internal/turn-metrics`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Auth': this.config.internalAuthToken,
        'X-Request-Timestamp': String(timestamp),
        'X-Request-Signature': signature,
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      this.logger.warn(
        { taskId: metrics.taskId, status: response.status },
        'Turn metrics publish failed (non-fatal)'
      );
    }
  }
}
