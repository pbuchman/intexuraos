import { context, trace, type SpanContext } from '@opentelemetry/api';
import { describe, expect, it } from 'vitest';
import { createOtelTraceMixin, getOtelTraceLogFields } from '../logging.js';

const spanContext: SpanContext = {
  traceId: '0af7651916cd43dd8448eb211c80319c',
  spanId: 'b7ad6b7169203331',
  traceFlags: 1,
};

describe('createOtelTraceMixin', () => {
  it('returns an empty object when no span context is active', () => {
    expect(createOtelTraceMixin()()).toEqual({});
  });

  it('adds active span trace identifiers to pino records', () => {
    const activeContext = trace.setSpanContext(context.active(), spanContext);

    expect(getOtelTraceLogFields(activeContext)).toEqual({
      traceId: spanContext.traceId,
      spanId: spanContext.spanId,
    });
  });

  it('omits invalid span contexts', () => {
    const invalidContext = trace.setSpanContext(context.active(), {
      ...spanContext,
      traceId: '0'.repeat(32),
    });

    expect(getOtelTraceLogFields(invalidContext)).toEqual({});
  });
});
