export class SampleNotFoundError extends Error {
  readonly code = 'SAMPLE_NOT_FOUND' as const;
  constructor() {
    super('Sample not found');
    this.name = 'SampleNotFoundError';
  }
}

export class MaxSamplesError extends Error {
  readonly code = 'MAX_SAMPLES' as const;
  constructor(max: number) {
    super(`Maximum ${String(max)} samples per category reached`);
    this.name = 'MaxSamplesError';
  }
}

export class BufferNotFoundError extends Error {
  readonly code = 'BUFFER_NOT_FOUND' as const;
  constructor() {
    super('Buffer not found');
    this.name = 'BufferNotFoundError';
  }
}

export class DraftGenerationError extends Error {
  readonly code = 'DRAFT_GENERATION_FAILED' as const;
  constructor() {
    super('Draft generation failed');
    this.name = 'DraftGenerationError';
  }
}
