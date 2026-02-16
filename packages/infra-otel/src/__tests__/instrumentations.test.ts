import { describe, it, expect } from 'vitest';
import { getInstrumentations } from '../instrumentations.js';

describe('getInstrumentations', () => {
  it('returns an array of instrumentation instances', () => {
    const instrumentations = getInstrumentations();

    expect(Array.isArray(instrumentations)).toBe(true);
    expect(instrumentations.length).toBeGreaterThan(0);
  });

  it('includes HTTP instrumentation', () => {
    const instrumentations = getInstrumentations();
    const names = instrumentations.map((i) => i.instrumentationName);

    expect(names).toContain('@opentelemetry/instrumentation-http');
  });

  it('includes Fastify instrumentation', () => {
    const instrumentations = getInstrumentations();
    const names = instrumentations.map((i) => i.instrumentationName);

    expect(names).toContain('@opentelemetry/instrumentation-fastify');
  });

  it('includes Pino instrumentation', () => {
    const instrumentations = getInstrumentations();
    const names = instrumentations.map((i) => i.instrumentationName);

    expect(names).toContain('@opentelemetry/instrumentation-pino');
  });
});
