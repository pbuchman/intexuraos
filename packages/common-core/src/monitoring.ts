/** Aggregate operational state: never expose job payloads or user identifiers. */
export interface JobExecutionRecord {
  key: string;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastSucceededAt: string | null;
  lastOutcome: 'never' | 'running' | 'succeeded' | 'failed';
}

export interface NotificationMonitoringSummary {
  pendingCount: number;
  failedCount: number;
  oldestPendingScheduledFor: string | null;
  lastDeliveredAt: string | null;
}

export interface MonitoringStatus {
  schemaVersion: 1;
  observedAt: string;
  jobs: JobExecutionRecord[];
  notifications?: NotificationMonitoringSummary;
}
