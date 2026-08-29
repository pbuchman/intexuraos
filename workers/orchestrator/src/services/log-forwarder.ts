import { readFileSync, existsSync } from 'node:fs';
import { createHmac, randomBytes } from 'node:crypto';
import { getErrorCauseChain, type Logger } from '@intexuraos/common-core';
import { SKIP_SENTRY_KEY } from '@intexuraos/infra-sentry';
import { stripDockerHeaders, stripBulkMetadata } from './log-formatter.js';
import { deriveCallbackBaseUrl } from './callback-url.js';

export interface LogForwarderConfig {
  logBasePath: string;
  codeAgentUrl: string;
  orchestratorSecret: string;
  internalAuthToken: string;
}

export interface ForwardingState {
  taskId: string;
  logFilePath: string;
  position: number;
  buffer: string;
  partialLine: string;
  pendingChunks: QueuedLogChunk[];
  totalBytes: number;
  droppedChunks: number;
  formattedUploadsStopped: boolean;
  timer: NodeJS.Timeout | null;
  pollTimer: NodeJS.Timeout | null;
  webhookSecret: string;
  callbackBaseUrl: string;
}

interface QueuedLogChunk {
  content: string;
  raw: boolean;
}

export interface LogForwarderDrainSnapshot {
  counterEpochId: string;
  processStartedAt: string;
  activeForwarders: number;
  bufferedBytes: number;
  partialLineBytes: number;
  queuedChunks: number;
  inFlightBatches: number;
  inFlightChunks: number;
  activeFlushOperations: number;
  openUploadRequests: number;
  detachedUploadRetryPromises: number;
  droppedChunksTotal: number;
  forwarderActivityTotal: number;
  lastActivityAt: string | null;
}

const MAX_CHUNK_SIZE = 64 * 1024; // 64KB — must exceed largest single JSON message (hook_response with build output)
const MAX_TOTAL_LOG_SIZE = 8 * 1024 * 1024; // 8MB
const CHUNK_INTERVAL_MS = 3 * 1000; // 3 seconds
const MAX_BATCH_SIZE = 5;

export class LogForwarder {
  private readonly forwarders = new Map<string, ForwardingState>();

  private readonly taskSecrets = new Map<string, string>();

  private readonly taskCallbackBaseUrls = new Map<string, string>();

  private readonly flushOperationsByTask = new Map<string, Set<Promise<void>>>();

  private readonly counterEpochId = randomBytes(16).toString('hex');

  private readonly processStartedAt = new Date().toISOString();

  private inFlightBatches = 0;

  private inFlightChunks = 0;

  private activeFlushOperations = 0;

  private openUploadRequests = 0;

  private detachedUploadRetryPromises = 0;

  private droppedChunksTotal = 0;

  private forwarderActivityTotal = 0;

  private lastActivityAt: string | null = null;

  constructor(
    private readonly config: LogForwarderConfig,
    private readonly logger: Logger
  ) {}

  private markActivity(): void {
    this.forwarderActivityTotal += 1;
    this.lastActivityAt = new Date().toISOString();
  }

  private recordDroppedChunks(state: ForwardingState, count: number): void {
    state.droppedChunks += count;
    this.droppedChunksTotal += count;
  }

  private closeForwarder(taskId: string): void {
    if (this.forwarders.delete(taskId)) {
      this.markActivity();
    }
  }

  private clearTimers(state: ForwardingState): void {
    if (state.timer !== null) {
      clearInterval(state.timer);
      state.timer = null;
    }
    if (state.pollTimer !== null) {
      clearInterval(state.pollTimer);
      state.pollTimer = null;
    }
  }

  private hasPendingWork(taskId: string, state: ForwardingState): boolean {
    return (
      state.buffer !== '' ||
      state.partialLine !== '' ||
      state.pendingChunks.length > 0 ||
      this.flushOperationsByTask.has(taskId)
    );
  }

  /**
   * Strip Docker headers and bulk metadata from raw log content in one pass.
   */
  private cleanContent(raw: string): string {
    return stripBulkMetadata(stripDockerHeaders(raw));
  }

  /**
   * Flush any remaining partial line into the buffer with formatting applied.
   */
  private drainPartialLine(state: ForwardingState): void {
    if (state.partialLine === '') return;
    const cleaned = this.cleanContent(state.partialLine + '\n');
    state.buffer += this.prefixTimestamps(cleaned);
    state.partialLine = '';
    this.markActivity();
  }

  /**
   * Register a task's webhook secret before starting log forwarding.
   * Must be called before appendChunk or startForwarding.
   */
  registerTask(taskId: string, webhookSecret: string, webhookUrl?: string): void {
    const callbackBaseUrl =
      webhookUrl === undefined
        ? undefined
        : deriveCallbackBaseUrl(webhookUrl, this.config.codeAgentUrl);
    this.taskSecrets.set(taskId, webhookSecret);
    if (callbackBaseUrl !== undefined) {
      this.taskCallbackBaseUrls.set(taskId, callbackBaseUrl);
    }
    const state = this.forwarders.get(taskId);
    if (state !== undefined) {
      state.webhookSecret = webhookSecret;
      if (callbackBaseUrl !== undefined) state.callbackBaseUrl = callbackBaseUrl;
      this.markActivity();
    }
  }

  /**
   * Unregister a task when it completes.
   */
  unregisterTask(taskId: string): void {
    this.taskSecrets.delete(taskId);
    this.taskCallbackBaseUrls.delete(taskId);
  }

  /**
   * Flush remaining logs and stop forwarding for a task.
   * Called when container exits to ensure no logs are lost.
   */
  async flushAndStop(taskId: string): Promise<void> {
    const state = this.forwarders.get(taskId);
    if (state === undefined) {
      return;
    }

    this.clearTimers(state);
    await this.flushUntilSettledAndClose(taskId, state, true);
  }

  startForwarding(taskId: string, logFilePath: string): void {
    if (this.forwarders.has(taskId)) {
      this.logger.warn({ taskId }, 'Log forwarding already started');
      return;
    }

    this.logger.info({ taskId, logFilePath }, 'Starting log forwarding');

    const webhookSecret = this.taskSecrets.get(taskId) ?? this.deriveWebhookSecret(taskId);
    const callbackBaseUrl =
      this.taskCallbackBaseUrls.get(taskId) ?? this.config.codeAgentUrl.replace(/\/+$/, '');

    const state: ForwardingState = {
      taskId,
      logFilePath,
      position: 0,
      buffer: '',
      partialLine: '',
      pendingChunks: [],
      totalBytes: 0,
      droppedChunks: 0,
      formattedUploadsStopped: false,
      timer: null,
      pollTimer: null,
      webhookSecret,
      callbackBaseUrl,
    };

    this.forwarders.set(taskId, state);
    this.markActivity();

    // Read existing file content if it exists
    if (existsSync(logFilePath)) {
      try {
        const content = readFileSync(logFilePath, 'utf-8');
        state.position = content.length;
      } catch (error) {
        this.logger.error({ taskId, error }, 'Failed to read existing log file');
      }
    }

    // Start polling for file changes
    state.pollTimer = setInterval(() => {
      this.readNewContent(taskId, logFilePath, state);
    }, 100); // Poll every 100ms

    // Start periodic flush timer
    state.timer = setInterval(() => {
      void this.flushBuffer(taskId, false, true);
    }, CHUNK_INTERVAL_MS);

    this.logger.info({ taskId }, 'Log forwarding started');
  }

  async stopForwarding(taskId: string): Promise<void> {
    const state = this.forwarders.get(taskId);
    if (!state) {
      this.logger.warn({ taskId }, 'No forwarding state to stop');
      return;
    }

    this.logger.info({ taskId }, 'Stopping log forwarding');

    this.clearTimers(state);
    await this.flushUntilSettledAndClose(taskId, state, false);

    this.logger.info({ taskId }, 'Log forwarding stopped');
  }

  getDroppedChunkCount(taskId: string): number {
    const state = this.forwarders.get(taskId);
    return state?.droppedChunks ?? 0;
  }

  /**
   * Append a chunk of log content directly (for Docker mode where logs come via callbacks).
   * Creates the forwarding state if it doesn't exist.
   */
  appendChunk(taskId: string, content: string): void {
    let state = this.forwarders.get(taskId);

    // Create state if it doesn't exist (Docker mode doesn't call startForwarding)
    if (state === undefined) {
      const webhookSecret = this.taskSecrets.get(taskId) ?? this.deriveWebhookSecret(taskId);
      const callbackBaseUrl =
        this.taskCallbackBaseUrls.get(taskId) ?? this.config.codeAgentUrl.replace(/\/+$/, '');
      state = {
        taskId,
        logFilePath: '',
        position: 0,
        buffer: '',
        partialLine: '',
        pendingChunks: [],
        totalBytes: 0,
        droppedChunks: 0,
        formattedUploadsStopped: false,
        timer: null,
        pollTimer: null,
        webhookSecret,
        callbackBaseUrl,
      };
      this.forwarders.set(taskId, state);
      this.markActivity();

      // Start periodic flush timer
      state.timer = setInterval(() => {
        void this.flushBuffer(taskId, false, true);
      }, CHUNK_INTERVAL_MS);
    }

    this.markActivity();

    // Reassemble partial lines across chunk boundaries
    const combined = state.partialLine + content;
    state.partialLine = '';

    const lastNewline = combined.lastIndexOf('\n');
    if (lastNewline === -1) {
      // No complete line yet — buffer everything
      state.partialLine = combined;
      return;
    }

    const complete = combined.slice(0, lastNewline + 1);
    state.partialLine = combined.slice(lastNewline + 1);

    state.buffer += this.prefixTimestamps(this.cleanContent(complete));

    // Flush if buffer exceeds max chunk size
    if (state.buffer.length >= MAX_CHUNK_SIZE) {
      this.queueFormattedBufferChunks(state);
      void this.flushBuffer(taskId, false, true);
    }
  }

  appendRawChunk(taskId: string, content: string): void {
    if (content === '') return;

    let state = this.forwarders.get(taskId);

    if (state === undefined) {
      const webhookSecret = this.taskSecrets.get(taskId) ?? this.deriveWebhookSecret(taskId);
      const callbackBaseUrl =
        this.taskCallbackBaseUrls.get(taskId) ?? this.config.codeAgentUrl.replace(/\/+$/, '');
      state = {
        taskId,
        logFilePath: '',
        position: 0,
        buffer: '',
        partialLine: '',
        pendingChunks: [],
        totalBytes: 0,
        droppedChunks: 0,
        formattedUploadsStopped: false,
        timer: null,
        pollTimer: null,
        webhookSecret,
        callbackBaseUrl,
      };
      this.forwarders.set(taskId, state);
      this.markActivity();

      state.timer = setInterval(() => {
        void this.flushBuffer(taskId, false, true);
      }, CHUNK_INTERVAL_MS);
    }

    this.markActivity();

    this.drainPartialLine(state);
    this.queueFormattedBufferChunks(state);
    state.pendingChunks.push(
      ...this.splitRawIntoChunks(content).map((chunk) => ({ content: chunk, raw: true }))
    );

    if (content.length >= MAX_CHUNK_SIZE) {
      void this.flushBuffer(taskId, false, true);
    }
  }

  private readNewContent(taskId: string, logFilePath: string, state: ForwardingState): void {
    // Check if file exists before reading
    if (!existsSync(logFilePath)) {
      return;
    }

    try {
      const content = readFileSync(logFilePath, 'utf-8');
      const newContent = content.slice(state.position);

      if (newContent.length === 0) return;

      state.position = content.length;
      state.buffer += this.cleanContent(newContent);
      this.markActivity();

      // Flush if buffer exceeds max chunk size
      if (state.buffer.length >= MAX_CHUNK_SIZE) {
        void this.flushBuffer(taskId, false, true);
      }
    } catch (error) {
      this.logger.error({ taskId, error }, 'Failed to read log file');
    }
  }

  private flushBuffer(taskId: string, force = false, detached = false): Promise<void> {
    let taskOperations = this.flushOperationsByTask.get(taskId);
    if (taskOperations === undefined) {
      taskOperations = new Set();
      this.flushOperationsByTask.set(taskId, taskOperations);
    }

    if (detached) this.detachedUploadRetryPromises += 1;
    const trackedOperation = this.performFlushBuffer(taskId, force).finally(() => {
      taskOperations.delete(trackedOperation);
      if (taskOperations.size === 0) {
        this.flushOperationsByTask.delete(taskId);
      }
      if (detached) this.detachedUploadRetryPromises -= 1;
    });
    taskOperations.add(trackedOperation);
    return trackedOperation;
  }

  private async waitForTaskFlushes(taskId: string): Promise<void> {
    let taskOperations = this.flushOperationsByTask.get(taskId);
    while (taskOperations !== undefined && taskOperations.size > 0) {
      await Promise.allSettled([...taskOperations]);
      taskOperations = this.flushOperationsByTask.get(taskId);
    }
  }

  private async flushUntilSettledAndClose(
    taskId: string,
    state: ForwardingState,
    force: boolean
  ): Promise<void> {
    while (this.forwarders.get(taskId) === state) {
      this.drainPartialLine(state);
      await this.flushBuffer(taskId, force);
      await this.waitForTaskFlushes(taskId);

      if (!this.hasPendingWork(taskId, state)) {
        this.closeForwarder(taskId);
        return;
      }
    }
  }

  private async performFlushBuffer(taskId: string, force = false): Promise<void> {
    const state = this.forwarders.get(taskId);
    if (!state) return;

    this.activeFlushOperations += 1;
    this.markActivity();
    try {
      this.queueFormattedBufferChunks(state);

      if (state.pendingChunks.length === 0) return;

      const sendableChunks: QueuedLogChunk[] = [];

      for (const chunk of state.pendingChunks) {
        if (chunk.raw) {
          sendableChunks.push(chunk);
          continue;
        }

        if (!force && (state.formattedUploadsStopped || state.totalBytes >= MAX_TOTAL_LOG_SIZE)) {
          if (!state.formattedUploadsStopped) {
            this.logger.warn(
              { taskId, totalBytes: state.totalBytes },
              'Max total log size reached, stopping uploads'
            );
            state.formattedUploadsStopped = true;
          }
          this.recordDroppedChunks(state, 1);
          continue;
        }

        sendableChunks.push(chunk);
      }

      const batches: QueuedLogChunk[][] = [];
      for (let i = 0; i < sendableChunks.length; i += MAX_BATCH_SIZE) {
        batches.push(sendableChunks.slice(i, i + MAX_BATCH_SIZE));
      }

      // Reserve every batch/chunk before clearing the queue. A synchronous
      // health snapshot can therefore never observe work in neither state.
      this.inFlightBatches += batches.length;
      this.inFlightChunks += sendableChunks.length;
      state.pendingChunks = [];

      let settledBatches = 0;
      let settledChunks = 0;
      try {
        for (const batch of batches) {
          try {
            await this.sendBatch(taskId, batch, state);
          } finally {
            this.inFlightBatches -= 1;
            this.inFlightChunks -= batch.length;
            settledBatches += 1;
            settledChunks += batch.length;
          }
        }
      } finally {
        // Defensive release for any batch not entered after an unexpected
        // exception. sendWithRetry normally contains transport failures.
        this.inFlightBatches -= batches.length - settledBatches;
        this.inFlightChunks -= sendableChunks.length - settledChunks;
      }
    } finally {
      this.activeFlushOperations -= 1;
      this.markActivity();
    }
  }

  private splitIntoChunks(buffer: string): string[] {
    const chunks: string[] = [];
    let remaining = buffer;

    while (remaining.length > 0) {
      if (remaining.length <= MAX_CHUNK_SIZE) {
        chunks.push(remaining);
        break;
      }

      const lastNewline = remaining.lastIndexOf('\n', MAX_CHUNK_SIZE);

      if (lastNewline <= 0) {
        // Single line exceeds MAX_CHUNK_SIZE — keep it intact so the
        // formatter can JSON.parse it. enforceChunkSize() will truncate
        // truly excessive lines downstream.
        const nextNewline = remaining.indexOf('\n', MAX_CHUNK_SIZE);
        if (nextNewline === -1) {
          chunks.push(remaining);
          break;
        }
        chunks.push(remaining.slice(0, nextNewline + 1));
        remaining = remaining.slice(nextNewline + 1);
      } else {
        chunks.push(remaining.slice(0, lastNewline + 1));
        remaining = remaining.slice(lastNewline + 1);
      }
    }

    return chunks;
  }

  private splitRawIntoChunks(content: string): string[] {
    const chunks: string[] = [];
    for (let offset = 0; offset < content.length; offset += MAX_CHUNK_SIZE) {
      chunks.push(content.slice(offset, offset + MAX_CHUNK_SIZE));
    }
    return chunks;
  }

  private queueFormattedBufferChunks(state: ForwardingState): void {
    if (state.buffer === '') return;
    const chunks = this.splitIntoChunks(state.buffer);
    state.buffer = '';
    state.pendingChunks.push(...chunks.map((content) => ({ content, raw: false })));
  }

  private async sendBatch(
    taskId: string,
    chunks: QueuedLogChunk[],
    state: ForwardingState
  ): Promise<void> {
    const now = Date.now();
    const chunkPayloads = chunks.map((chunk, index) => {
      return {
        sequence: now + index,
        content: chunk.raw ? chunk.content : this.enforceChunkSize(chunk.content),
        timestamp: new Date().toISOString(),
      };
    });

    const payload = {
      taskId,
      chunks: chunkPayloads,
    };

    const result = await this.sendWithRetry(payload, state.webhookSecret);

    if (result.success) {
      state.totalBytes += chunks.reduce(
        (sum, chunk) => sum + (chunk.raw ? 0 : chunk.content.length),
        0
      );
    } else {
      this.recordDroppedChunks(state, chunks.length);
      this.logger.error(
        {
          taskId,
          count: chunks.length,
          url: `${state.callbackBaseUrl}/internal/logs`,
          [SKIP_SENTRY_KEY]: true,
        },
        'Failed to upload log chunks after retries'
      );
    }
  }

  private async sendWithRetry(
    payload: {
      taskId: string;
      chunks: { sequence: number; content: string; timestamp: string }[];
    },
    webhookSecret: string
  ): Promise<{ success: boolean }> {
    const state = this.forwarders.get(payload.taskId);
    /* v8 ignore start -- ts-type: optional chaining and nullish coalescing fallback; production registerTask always defines callbackBaseUrl before flushing @preserve */
    const baseUrl = state?.callbackBaseUrl ?? this.config.codeAgentUrl.replace(/\/+$/, '');
    /* v8 ignore stop @preserve */
    const url = `${baseUrl}/internal/logs`;
    const jsonBody = JSON.stringify(payload);
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = this.signPayload(jsonBody, timestamp, webhookSecret);

    const delays = [1000, 2000, 4000];

    for (let i = 0; i < 3; i++) {
      this.markActivity();
      try {
        let response: Response;
        this.openUploadRequests += 1;
        try {
          response = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Request-Timestamp': String(timestamp),
              'X-Request-Signature': signature,
              'X-Internal-Auth': this.config.internalAuthToken,
            },
            body: jsonBody,
          });
          await response.body?.cancel();
        } finally {
          this.openUploadRequests -= 1;
        }

        if (response.ok) {
          this.markActivity();
          return { success: true };
        }

        if (response.status >= 400 && response.status < 500) {
          this.markActivity();
          this.logger.error(
            { taskId: payload.taskId, status: response.status, url },
            'Log upload rejected with client error - not retrying'
          );
          return { success: false };
        }

        this.logger.warn(
          {
            taskId: payload.taskId,
            attempt: i + 1,
            status: response.status,
            url,
            [SKIP_SENTRY_KEY]: true,
          },
          'Log upload failed, retrying'
        );
        this.markActivity();
      } catch (error) {
        const errorInfo =
          error instanceof Error
            ? { name: error.name, message: error.message, cause: getErrorCauseChain(error) }
            : { error };
        this.logger.warn(
          { taskId: payload.taskId, attempt: i + 1, url, ...errorInfo, [SKIP_SENTRY_KEY]: true },
          'Log upload failed, retrying'
        );
        this.markActivity();
      }

      if (i < 2) {
        await new Promise((resolve) => setTimeout(resolve, delays[i]));
      }
    }

    return { success: false };
  }

  /**
   * Prefix each non-empty line with a local timestamp (HH:MM:ss.mmm).
   * Lines already prefixed by appendOrchestratorTaskLog are detected by the
   * leading timestamp pattern and left unchanged.
   */
  private prefixTimestamps(text: string): string {
    const now = new Date();
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    const s = String(now.getSeconds()).padStart(2, '0');
    const ms = String(now.getMilliseconds()).padStart(3, '0');
    const ts = `${h}:${m}:${s}.${ms}`;

    return text.replace(/^(.+)$/gm, (line) => {
      if (/^\d{2}:\d{2}:\d{2}\.\d{3} /.test(line)) return line;
      return `${ts} ${line}`;
    });
  }

  /**
   * Derive a deterministic webhook secret from orchestratorSecret + taskId.
   * Used as fallback when the secret is not in the in-memory taskSecrets map
   * (e.g. after orchestrator restart while containers survive).
   */
  private deriveWebhookSecret(taskId: string): string {
    return createHmac('sha256', this.config.orchestratorSecret).update(taskId).digest('hex');
  }

  private signPayload(payload: string, timestamp: number, secret: string): string {
    const message = `${String(timestamp)}.${payload}`;
    return createHmac('sha256', secret).update(message).digest('hex');
  }

  private enforceChunkSize(chunk: string): string {
    if (chunk.length <= MAX_CHUNK_SIZE) return chunk;

    const tailSize = 1024;
    const marker = '\n[... TRUNCATED ...]\n';
    const headSize = MAX_CHUNK_SIZE - tailSize - marker.length;
    const head = chunk.slice(0, headSize);
    const tail = chunk.slice(-tailSize);

    return head + marker + tail;
  }

  async flush(taskId: string): Promise<void> {
    const state = this.forwarders.get(taskId);
    if (state === undefined) return;

    this.drainPartialLine(state);
    await this.flushBuffer(taskId, true);
  }

  close(taskId: string): void {
    const state = this.forwarders.get(taskId);
    if (state === undefined) return;
    if (this.hasPendingWork(taskId, state)) {
      throw new Error('Cannot close log forwarder while work is pending');
    }
    this.clearTimers(state);
    this.closeForwarder(taskId);
  }

  getActiveTaskIds(): string[] {
    return Array.from(this.forwarders.keys());
  }

  getDrainSnapshot(): LogForwarderDrainSnapshot {
    let bufferedBytes = 0;
    let partialLineBytes = 0;
    let queuedChunks = 0;

    for (const state of this.forwarders.values()) {
      bufferedBytes += Buffer.byteLength(state.buffer, 'utf8');
      partialLineBytes += Buffer.byteLength(state.partialLine, 'utf8');
      queuedChunks += state.pendingChunks.length;
    }

    return {
      counterEpochId: this.counterEpochId,
      processStartedAt: this.processStartedAt,
      activeForwarders: this.forwarders.size,
      bufferedBytes,
      partialLineBytes,
      queuedChunks,
      inFlightBatches: this.inFlightBatches,
      inFlightChunks: this.inFlightChunks,
      activeFlushOperations: this.activeFlushOperations,
      openUploadRequests: this.openUploadRequests,
      detachedUploadRetryPromises: this.detachedUploadRetryPromises,
      droppedChunksTotal: this.droppedChunksTotal,
      forwarderActivityTotal: this.forwarderActivityTotal,
      lastActivityAt: this.lastActivityAt,
    };
  }
}
