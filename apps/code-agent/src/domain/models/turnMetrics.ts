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
