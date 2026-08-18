import { describe, expect, it } from 'vitest';
import {
  assertIntexAgentCatalogConformance,
  INTEX_AGENT_CATALOG_SNAPSHOT_VERSION,
  INTEX_AGENT_REQUIRED_PARAMETERS,
} from '../intexAgentCatalog.js';

function reviewedCatalog(): unknown {
  return {
    data: [
      {
        id: 'deepseek/deepseek-v4-flash',
        context_length: 1_048_576,
        pricing: {
          prompt: '0.000000098',
          completion: '0.000000196',
          input_cache_read: '0.0000000196',
        },
        architecture: { input_modalities: ['text'], output_modalities: ['text'] },
        supported_parameters: [...INTEX_AGENT_REQUIRED_PARAMETERS],
      },
      {
        id: 'minimax/minimax-m3',
        context_length: 205_000,
        pricing: { prompt: '0.0000003', completion: '0.0000012' },
        architecture: { input_modalities: ['text'], output_modalities: ['text'] },
        supported_parameters: [...INTEX_AGENT_REQUIRED_PARAMETERS],
      },
      {
        id: 'google/gemini-3.6-flash',
        context_length: 1_048_576,
        pricing: { prompt: '0.0000015', completion: '0.0000075' },
        architecture: { input_modalities: ['text'], output_modalities: ['text'] },
        supported_parameters: [...INTEX_AGENT_REQUIRED_PARAMETERS],
      },
    ],
  };
}

describe('assertIntexAgentCatalogConformance', () => {
  it('audits the three canonical Intex models with reviewed DeepSeek metadata', () => {
    const evidence = assertIntexAgentCatalogConformance(
      reviewedCatalog(),
      '2026-07-19T12:00:00.000Z'
    );

    expect(evidence.snapshotVersion).toBe(INTEX_AGENT_CATALOG_SNAPSHOT_VERSION);
    expect(evidence.snapshotVersion).toBe('2026-08-18');
    expect(evidence.fetchedAt).toBe('2026-07-19T12:00:00.000Z');
    expect(evidence.models.map((model) => model.id)).toEqual([
      'or:deepseek/deepseek-v4-flash',
      'or:minimax/minimax-m3',
      'or:google/gemini-3.6-flash',
    ]);
    expect(evidence.models[0]).toMatchObject({
      rawId: 'deepseek/deepseek-v4-flash',
      contextLength: 1_048_576,
      promptPerToken: 0.000000098,
      completionPerToken: 0.000000196,
      cacheReadPerToken: 0.0000000196,
      inputModalities: ['text'],
      outputModalities: ['text'],
      requiredParameters: INTEX_AGENT_REQUIRED_PARAMETERS,
      entryDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });

  it('fails closed when a required model is absent', () => {
    const catalog = reviewedCatalog() as { data: unknown[] };
    catalog.data = catalog.data.slice(1);

    expect(() => assertIntexAgentCatalogConformance(catalog, '2026-07-19T12:00:00.000Z')).toThrow(
      'deepseek/deepseek-v4-flash'
    );
  });

  it('fails closed for malformed roots, data, entries, and entry identifiers', () => {
    expect(() => assertIntexAgentCatalogConformance(null, '2026-07-19T12:00:00.000Z')).toThrow(
      'response'
    );
    expect(() =>
      assertIntexAgentCatalogConformance({ data: {} }, '2026-07-19T12:00:00.000Z')
    ).toThrow('data');
    expect(() =>
      assertIntexAgentCatalogConformance({ data: [null] }, '2026-07-19T12:00:00.000Z')
    ).toThrow('entry');

    const catalog = reviewedCatalog() as { data: unknown[] };
    catalog.data.push({ id: 123 });
    expect(
      assertIntexAgentCatalogConformance(catalog, '2026-07-19T12:00:00.000Z').models
    ).toHaveLength(3);
  });

  it.each([
    ['minimax/minimax-m3', 1],
    ['google/gemini-3.6-flash', 2],
  ])('fails closed when required model %s is absent', (id, index) => {
    const catalog = reviewedCatalog() as { data: unknown[] };
    catalog.data.splice(index, 1);

    expect(() => assertIntexAgentCatalogConformance(catalog, '2026-07-19T12:00:00.000Z')).toThrow(
      id
    );
  });

  it.each([
    ['DeepSeek', 0, 999_999],
    ['Gemini', 2, 1_048_575],
  ])(
    'fails closed when %s is below its reviewed context minimum',
    (_name, index, contextLength) => {
      const catalog = reviewedCatalog() as {
        data: { id: string; context_length: number }[];
      };
      const entry = catalog.data[index];
      if (entry === undefined) throw new Error('Test setup failed');
      entry.context_length = contextLength;

      expect(() => assertIntexAgentCatalogConformance(catalog, '2026-07-19T12:00:00.000Z')).toThrow(
        'context'
      );
    }
  );

  it('fails closed when MiniMax is below its reviewed 205K context minimum', () => {
    const catalog = reviewedCatalog() as {
      data: { context_length: number }[];
    };
    const entry = catalog.data[1];
    if (entry === undefined) throw new Error('Test setup failed');
    entry.context_length = 204_999;

    expect(() => assertIntexAgentCatalogConformance(catalog, '2026-07-19T12:00:00.000Z')).toThrow(
      'context'
    );
  });

  it.each(['0', '-0.0000001', 'not-a-number'])(
    'fails closed on malformed or non-positive provider pricing %s',
    (prompt) => {
      const catalog = reviewedCatalog() as {
        data: { pricing: { prompt: string } }[];
      };
      const entry = catalog.data[0];
      if (entry === undefined) throw new Error('Test setup failed');
      entry.pricing.prompt = prompt;

      expect(() => assertIntexAgentCatalogConformance(catalog, '2026-07-19T12:00:00.000Z')).toThrow(
        'pricing'
      );
    }
  );

  it('fails closed when provider pricing is not a number or non-empty numeric string', () => {
    const catalog = reviewedCatalog() as {
      data: { pricing: { prompt: unknown } }[];
    };
    const entry = catalog.data[0];
    if (entry === undefined) throw new Error('Test setup failed');
    entry.pricing.prompt = null;

    expect(() => assertIntexAgentCatalogConformance(catalog, '2026-07-19T12:00:00.000Z')).toThrow(
      'pricing'
    );
  });

  it.each(['0', '-0.0000001', 'not-a-number'])(
    'fails closed on malformed or non-positive completion pricing %s',
    (completion) => {
      const catalog = reviewedCatalog() as {
        data: { pricing: { completion: string } }[];
      };
      const entry = catalog.data[0];
      if (entry === undefined) throw new Error('Test setup failed');
      entry.pricing.completion = completion;

      expect(() => assertIntexAgentCatalogConformance(catalog, '2026-07-19T12:00:00.000Z')).toThrow(
        'pricing'
      );
    }
  );

  it('fails closed when structured tool parameters are missing', () => {
    const catalog = reviewedCatalog() as {
      data: { supported_parameters: string[] }[];
    };
    const entry = catalog.data[1];
    if (entry === undefined) throw new Error('Test setup failed');
    entry.supported_parameters = ['tools', 'tool_choice', 'response_format'];

    expect(() => assertIntexAgentCatalogConformance(catalog, '2026-07-19T12:00:00.000Z')).toThrow(
      'structured_outputs'
    );
  });

  it('fails closed when structured tool parameters are not strings', () => {
    const catalog = reviewedCatalog() as {
      data: { supported_parameters: unknown[] }[];
    };
    const entry = catalog.data[1];
    if (entry === undefined) throw new Error('Test setup failed');
    entry.supported_parameters = [1];

    expect(() => assertIntexAgentCatalogConformance(catalog, '2026-07-19T12:00:00.000Z')).toThrow(
      'supported parameters'
    );
  });

  it.each(['input_modalities', 'output_modalities'] as const)(
    'fails closed when %s does not include text',
    (field) => {
      const catalog = reviewedCatalog() as {
        data: { architecture: { input_modalities: string[]; output_modalities: string[] } }[];
      };
      const entry = catalog.data[0];
      if (entry === undefined) throw new Error('Test setup failed');
      entry.architecture[field] = ['image'];

      expect(() => assertIntexAgentCatalogConformance(catalog, '2026-07-19T12:00:00.000Z')).toThrow(
        'text modalities'
      );
    }
  );

  it('fails closed when text modalities are malformed', () => {
    const catalog = reviewedCatalog() as {
      data: { architecture: { input_modalities: unknown[] } }[];
    };
    const entry = catalog.data[0];
    if (entry === undefined) throw new Error('Test setup failed');
    entry.architecture.input_modalities = [1];

    expect(() => assertIntexAgentCatalogConformance(catalog, '2026-07-19T12:00:00.000Z')).toThrow(
      'modalities are malformed'
    );
  });

  it('uses changed positive provider-reported DeepSeek cache-read pricing', () => {
    const catalog = reviewedCatalog() as {
      data: { pricing: { input_cache_read?: string } }[];
    };
    const entry = catalog.data[0];
    if (entry === undefined) throw new Error('Test setup failed');
    entry.pricing.input_cache_read = '0.00000002';

    expect(
      assertIntexAgentCatalogConformance(catalog, '2026-07-19T12:00:00.000Z').models[0]
        ?.cacheReadPerToken
    ).toBe(0.00000002);
  });

  it('fails closed when provider-reported DeepSeek cache-read pricing is non-positive', () => {
    const catalog = reviewedCatalog() as {
      data: { pricing: { input_cache_read?: string } }[];
    };
    const entry = catalog.data[0];
    if (entry === undefined) throw new Error('Test setup failed');
    entry.pricing.input_cache_read = '0';

    expect(() => assertIntexAgentCatalogConformance(catalog, '2026-07-19T12:00:00.000Z')).toThrow(
      'cache-read pricing'
    );
  });
});
