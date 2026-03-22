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
