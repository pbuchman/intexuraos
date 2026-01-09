/**
 * Tests for repairAttribution use case.
 */

import { describe, expect, it, vi, type Mock } from 'vitest';
import { ok, err } from '@intexuraos/common-core';
import type { SourceMapItem } from '@intexuraos/llm-common';
import { repairAttribution } from '../../../../domain/research/usecases/repairAttribution.js';
import type { LlmSynthesisProvider } from '../../../../domain/research/ports/llmProvider.js';

interface MockSynthesizer {
  synthesize: Mock<
    (
      prompt: string,
      reports: { model: string; content: string }[],
      additionalSources?: { content: string; label?: string }[],
      synthesisContext?: unknown
    ) => Promise<unknown>
  >;
  generateTitle: Mock;
}

interface MockLogger {
  info: Mock<(msg: string) => void>;
  error: Mock<(obj: object, msg: string) => void>;
}

function createMockSynthesizer(): MockSynthesizer {
  return {
    synthesize: vi.fn(),
    generateTitle: vi.fn().mockResolvedValue(
      ok({ title: 'Title', usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.001 } })
    ),
  };
}

function createMockLogger(): MockLogger {
  return {
    info: vi.fn(),
    error: vi.fn(),
  };
}

const testSourceMap: readonly SourceMapItem[] = [
  { id: 'S1', kind: 'llm', displayName: 'GPT-4' },
  { id: 'S2', kind: 'llm', displayName: 'Claude' },
  { id: 'U1', kind: 'user', displayName: 'Wikipedia' },
];

describe('repairAttribution', () => {
  it('returns repaired content when synthesizer succeeds', async () => {
    const synthesizer = createMockSynthesizer();
    const logger = createMockLogger();

    synthesizer.synthesize.mockResolvedValue(
      ok({
        content:
          'Repaired content with Attribution: Primary=S1; Secondary=; Constraints=; UNK=false',
        usage: { inputTokens: 100, outputTokens: 50, costUsd: 0.005 },
      })
    );

    const result = await repairAttribution('Raw content without attribution', testSourceMap, {
      synthesizer: synthesizer as unknown as LlmSynthesisProvider,
      logger,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.content).toContain('Repaired content');
      expect(result.value.usage.costUsd).toBe(0.005);
    }
    expect(logger.info).toHaveBeenCalledWith('Attempting attribution repair');
    expect(logger.info).toHaveBeenCalledWith('Attribution repair completed');
  });

  it('returns error when source map is empty', async () => {
    const synthesizer = createMockSynthesizer();
    const logger = createMockLogger();

    const result = await repairAttribution('Raw content', [], {
      synthesizer: synthesizer as unknown as LlmSynthesisProvider,
      logger,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Cannot repair attribution: empty source map');
    }
    expect(logger.error).toHaveBeenCalledWith({}, 'Cannot repair attribution: empty source map');
    expect(synthesizer.synthesize).not.toHaveBeenCalled();
  });

  it('returns error when synthesizer fails', async () => {
    const synthesizer = createMockSynthesizer();
    const logger = createMockLogger();

    synthesizer.synthesize.mockResolvedValue(
      err({ code: 'API_ERROR', message: 'LLM call failed' })
    );

    const result = await repairAttribution('Raw content', testSourceMap, {
      synthesizer: synthesizer as unknown as LlmSynthesisProvider,
      logger,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Attribution repair failed: LLM call failed');
    }
    expect(logger.error).toHaveBeenCalledWith(
      { code: 'API_ERROR' },
      'Attribution repair failed: LLM call failed'
    );
  });

  it('includes allowed source IDs in repair prompt', async () => {
    const synthesizer = createMockSynthesizer();
    synthesizer.synthesize.mockResolvedValue(ok({ content: 'Repaired' }));

    await repairAttribution('Raw content', testSourceMap, {
      synthesizer: synthesizer as unknown as LlmSynthesisProvider,
    });

    expect(synthesizer.synthesize).toHaveBeenCalledWith(
      expect.stringContaining('ALLOWED SOURCE IDs: S1, S2, U1'),
      [],
      undefined,
      undefined
    );
  });

  it('includes raw content in repair prompt', async () => {
    const synthesizer = createMockSynthesizer();
    synthesizer.synthesize.mockResolvedValue(ok({ content: 'Repaired' }));

    const rawContent = 'This is the original synthesis without proper attribution';
    await repairAttribution(rawContent, testSourceMap, {
      synthesizer: synthesizer as unknown as LlmSynthesisProvider,
    });

    expect(synthesizer.synthesize).toHaveBeenCalledWith(
      expect.stringContaining(rawContent),
      [],
      undefined,
      undefined
    );
  });

  it('includes attribution format instructions in repair prompt', async () => {
    const synthesizer = createMockSynthesizer();
    synthesizer.synthesize.mockResolvedValue(ok({ content: 'Repaired' }));

    await repairAttribution('Raw content', testSourceMap, {
      synthesizer: synthesizer as unknown as LlmSynthesisProvider,
    });

    expect(synthesizer.synthesize).toHaveBeenCalledWith(
      expect.stringContaining('Attribution: Primary=S1,S2; Secondary=U1; Constraints=; UNK=false'),
      [],
      undefined,
      undefined
    );
  });

  it('works without logger', async () => {
    const synthesizer = createMockSynthesizer();
    synthesizer.synthesize.mockResolvedValue(ok({ content: 'Repaired' }));

    const result = await repairAttribution('Raw content', testSourceMap, {
      synthesizer: synthesizer as unknown as LlmSynthesisProvider,
    });

    expect(result.ok).toBe(true);
  });
});
