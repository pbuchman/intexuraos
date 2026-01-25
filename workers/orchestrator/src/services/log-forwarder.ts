import { readFileSync, existsSync } from 'node:fs';
import type { Logger } from '@intexuraos/common-core';

export interface LogForwarderConfig {
  logBasePath: string;
  firestore: {
    collection: (path: string) => {
      add: (data: LogChunkData) => Promise<{ id: string }>;
    };
  };
}

export interface LogChunkData {
  taskId: string;
  sequence: number;
  content: string;
  timestamp: Date;
}

export interface ForwardingState {
  taskId: string;
  logFilePath: string;
  position: number;
  buffer: string;
  sequence: number;
  chunksSent: number;
  totalBytes: number;
  droppedChunks: number;
  timer: NodeJS.Timeout | null;
  pollTimer: NodeJS.Timeout | null;
}

const MAX_CHUNK_SIZE = 8 * 1024; // 8KB
const MAX_CHUNKS_PER_TASK = 500;
const MAX_TOTAL_LOG_SIZE = 4 * 1024 * 1024; // 4MB
const CHUNK_INTERVAL_MS = 10 * 1000; // 10 seconds
const MAX_BATCH_SIZE = 5;

export class LogForwarder {
  private readonly forwarders = new Map<string, ForwardingState>();

  constructor(
    private readonly config: LogForwarderConfig,
    private readonly logger: Logger
  ) {}

  startForwarding(taskId: string, logFilePath: string): void {
    if (this.forwarders.has(taskId)) {
      this.logger.warn({ taskId }, 'Log forwarding already started');
      return;
    }

    this.logger.info({ taskId, logFilePath }, 'Starting log forwarding');

    const state: ForwardingState = {
      taskId,
      logFilePath,
      position: 0,
      buffer: '',
      sequence: 0,
      chunksSent: 0,
      totalBytes: 0,
      droppedChunks: 0,
      timer: null,
      pollTimer: null,
    };

    this.forwarders.set(taskId, state);

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
      void this.flushBuffer(taskId);
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

    // Clear timers
    if (state.timer) {
      clearInterval(state.timer);
      state.timer = null;
    }

    if (state.pollTimer) {
      clearInterval(state.pollTimer);
      state.pollTimer = null;
    }

    // Flush remaining buffer
    await this.flushBuffer(taskId);

    // Remove state
    this.forwarders.delete(taskId);

    this.logger.info({ taskId }, 'Log forwarding stopped');
  }

  getDroppedChunkCount(taskId: string): number {
    const state = this.forwarders.get(taskId);
    return state?.droppedChunks ?? 0;
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
      state.buffer += newContent;

      // Flush if buffer exceeds max chunk size
      if (state.buffer.length >= MAX_CHUNK_SIZE) {
        void this.flushBuffer(taskId);
      }
    } catch (error) {
      this.logger.error({ taskId, error }, 'Failed to read log file');
    }
  }

  private async flushBuffer(taskId: string): Promise<void> {
    const state = this.forwarders.get(taskId);
    if (!state || state.buffer.length === 0) return;

    // Check size limits
    if (state.chunksSent >= MAX_CHUNKS_PER_TASK) {
      this.logger.warn(
        { taskId, chunksSent: state.chunksSent },
        'Max chunks per task reached, stopping uploads'
      );
      state.droppedChunks += 1;
      state.buffer = '';
      return;
    }

    if (state.totalBytes >= MAX_TOTAL_LOG_SIZE) {
      this.logger.warn(
        { taskId, totalBytes: state.totalBytes },
        'Max total log size reached, stopping uploads'
      );
      state.droppedChunks += 1;
      state.buffer = '';
      return;
    }

    // Split buffer into chunks
    const chunks = this.splitIntoChunks(state.buffer);
    state.buffer = ''; // Clear buffer after splitting

    // Send chunks in batches
    for (let i = 0; i < chunks.length; i += MAX_BATCH_SIZE) {
      const batch = chunks.slice(i, i + MAX_BATCH_SIZE);
      await this.sendBatch(taskId, batch, state);
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

      // Find last newline before max chunk size
      let splitPoint = MAX_CHUNK_SIZE;
      const lastNewline = remaining.lastIndexOf('\n', MAX_CHUNK_SIZE);

      if (lastNewline > MAX_CHUNK_SIZE * 0.8) {
        // Prefer splitting at newline if it's not too far back
        splitPoint = lastNewline + 1;
      }

      chunks.push(remaining.slice(0, splitPoint));
      remaining = remaining.slice(splitPoint);
    }

    return chunks;
  }

  private async sendBatch(taskId: string, chunks: string[], state: ForwardingState): Promise<void> {
    for (const chunk of chunks) {
      const truncated = this.enforceChunkSize(chunk);
      const chunkData: LogChunkData = {
        taskId,
        sequence: state.sequence,
        content: truncated,
        timestamp: new Date(),
      };

      const success = await this.retryUpload(async () => {
        const collection = this.config.firestore.collection(`code_tasks/${taskId}/logs`);
        await collection.add(chunkData);
      });

      if (success) {
        state.sequence += 1;
        state.chunksSent += 1;
        state.totalBytes += truncated.length;
      } else {
        state.droppedChunks += 1;
        this.logger.error(
          { taskId, sequence: state.sequence },
          'Failed to upload log chunk after retries'
        );
      }
    }
  }

  private enforceChunkSize(chunk: string): string {
    if (chunk.length <= MAX_CHUNK_SIZE) return chunk;

    // Truncate and preserve last 1KB
    const tailSize = 1024;
    const tail = chunk.slice(-tailSize);
    const marker = '\n[... TRUNCATED ...]\n';

    return tail + marker;
  }

  private async retryUpload<T>(fn: () => Promise<T>, attempts = 3): Promise<boolean> {
    const delays = [1000, 2000, 4000]; // Exponential backoff

    for (let i = 0; i < attempts; i++) {
      try {
        await fn();
        return true;
      } catch (error) {
        this.logger.warn({ attempt: i + 1, error }, 'Upload failed, retrying');

        if (i < attempts - 1) {
          await new Promise((resolve) => setTimeout(resolve, delays[i]));
        }
      }
    }

    return false;
  }

  getActiveTaskIds(): string[] {
    return Array.from(this.forwarders.keys());
  }
}
