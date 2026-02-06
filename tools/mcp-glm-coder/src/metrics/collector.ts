import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import type { AttemptMetrics, GLMCallMetrics, TaskType, PostHocEvent } from '../types.js';
import { logger } from '../utils/logger.js';

const METRICS_DIR = join(homedir(), '.glm-coder');
const METRICS_FILE = join(METRICS_DIR, 'metrics.jsonl');
const POST_HOC_FILE = join(METRICS_DIR, 'post-hoc.jsonl');

function ensureMetricsDir(): void {
  if (!existsSync(METRICS_DIR)) {
    mkdirSync(METRICS_DIR, { recursive: true });
  }
}

export class MetricsCollector {
  private currentCall: Partial<GLMCallMetrics> | null = null;
  private startTime: number = 0;

  startCall(params: {
    taskType: TaskType;
    taskDescription: string;
    contextFilesCount: number;
    contextTokensEstimate: number;
    targetFile: string | null;
  }): string {
    const id = randomUUID();
    this.startTime = Date.now();
    this.currentCall = {
      id,
      timestamp: new Date().toISOString(),
      sessionId: process.env.CLAUDE_SESSION_ID ?? 'unknown',
      taskType: params.taskType,
      taskDescription: params.taskDescription.slice(0, 500),
      contextFilesCount: params.contextFilesCount,
      contextTokensEstimate: params.contextTokensEstimate,
      targetFile: params.targetFile,
      attempts: [],
      validationErrors: [],
    };
    return id;
  }

  recordAttempt(attempt: AttemptMetrics): void {
    if (this.currentCall?.attempts) {
      this.currentCall.attempts.push(attempt);
    }
  }

  finishCall(result: {
    finalSuccess: boolean;
    outputTokensEstimate: number;
    validationErrors: string[];
  }): GLMCallMetrics | null {
    if (!this.currentCall) return null;

    const metrics: GLMCallMetrics = {
      ...this.currentCall,
      finalSuccess: result.finalSuccess,
      totalLatencyMs: Date.now() - this.startTime,
      outputTokensEstimate: result.outputTokensEstimate,
      validationErrors: result.validationErrors,
    } as GLMCallMetrics;

    this.persist(metrics);
    this.currentCall = null;
    return metrics;
  }

  getCurrentCallId(): string | null {
    return this.currentCall?.id ?? null;
  }

  private persist(metrics: GLMCallMetrics): void {
    ensureMetricsDir();
    appendFileSync(METRICS_FILE, JSON.stringify(metrics) + '\n');
    logger.debug('Metrics saved', { id: metrics.id });
  }
}

export function loadMetrics(): GLMCallMetrics[] {
  if (!existsSync(METRICS_FILE)) {
    return [];
  }
  const content = readFileSync(METRICS_FILE, 'utf-8').trim();
  if (!content) return [];
  return content.split('\n').map((line) => JSON.parse(line) as GLMCallMetrics);
}

export function loadPostHocEvents(): PostHocEvent[] {
  if (!existsSync(POST_HOC_FILE)) {
    return [];
  }
  const content = readFileSync(POST_HOC_FILE, 'utf-8').trim();
  if (!content) return [];
  return content.split('\n').map((line) => JSON.parse(line) as PostHocEvent);
}

export function recordPostHocEdit(callId: string, editedFile: string): void {
  ensureMetricsDir();
  const event: PostHocEvent = {
    callId,
    manualEditsRequired: true,
    timestamp: new Date().toISOString(),
    editedFile,
  };
  appendFileSync(POST_HOC_FILE, JSON.stringify(event) + '\n');
}

export function getMetricsDir(): string {
  return METRICS_DIR;
}

export function getMetricsFile(): string {
  return METRICS_FILE;
}

export const collector = new MetricsCollector();
