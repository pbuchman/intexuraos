import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@intexuraos/common-core';
import {
  createOpenRouterCatalogClient,
  createOpenRouterCatalogEntryMap,
  createOpenRouterCatalogModelIdSet,
} from '../catalogClient.js';
import { INTEX_AGENT_REQUIRED_PARAMETERS } from '../intexAgentCatalog.js';

const logger: Logger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
};

function catalog(): unknown {
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

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('createOpenRouterCatalogClient', () => {
  it('performs one bounded startup fetch and serves the fresh snapshot', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(catalog()));
    const client = createOpenRouterCatalogClient({
      apiKey: 'test-key',
      logger,
      fetchImpl,
      now: () => new Date('2026-07-19T12:00:00.000Z'),
    });

    const first = await client.start();
    const second = await client.getCatalog();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/models',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer test-key' }),
        signal: expect.any(AbortSignal),
      })
    );
    expect(second).toBe(first);
    expect(first?.fetchedAt).toBe('2026-07-19T12:00:00.000Z');
  });

  it('single-flights concurrent refreshes after freshness expires', async () => {
    let resolveFetch: ((response: Response) => void) | undefined;
    const fetchImpl = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        })
    );
    const client = createOpenRouterCatalogClient({ apiKey: 'test-key', logger, fetchImpl });

    const first = client.getCatalog();
    const second = client.getCatalog();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    if (resolveFetch === undefined) throw new Error('Test setup failed');
    resolveFetch(jsonResponse(catalog()));

    expect(await first).toEqual(await second);
  });

  it('rejects oversized catalog responses without parsing or logging their body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response('untrusted catalog body', {
        status: 200,
        headers: { 'content-length': String(5 * 1024 * 1024 + 1) },
      })
    );
    const client = createOpenRouterCatalogClient({ apiKey: 'test-key', logger, fetchImpl });

    await expect(client.getCatalog()).resolves.toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'response_too_large' }),
      'OpenRouter catalog refresh failed'
    );
    expect(JSON.stringify((logger.warn as ReturnType<typeof vi.fn>).mock.calls)).not.toContain(
      'untrusted catalog body'
    );
  });

  it('aborts and cancels an advertised oversized streaming response', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel(): void {
        cancelled = true;
      },
    });
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(body, {
        status: 200,
        headers: { 'content-length': String(5 * 1024 * 1024 + 1) },
      })
    );
    const client = createOpenRouterCatalogClient({ apiKey: 'test-key', logger, fetchImpl });

    await expect(client.getCatalog()).resolves.toBeNull();

    expect(cancelled).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'response_too_large' }),
      'OpenRouter catalog refresh failed'
    );
  });

  it('aborts an advertised oversized response even when it has no body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 200,
        headers: { 'content-length': String(5 * 1024 * 1024 + 1) },
      })
    );
    const client = createOpenRouterCatalogClient({ apiKey: 'test-key', logger, fetchImpl });

    await expect(client.getCatalog()).resolves.toBeNull();
  });

  it('rejects an empty body and a bounded response with invalid schema', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(jsonResponse({ invalid: [] }));
    const client = createOpenRouterCatalogClient({
      apiKey: 'test-key',
      logger,
      fetchImpl,
      now: vi
        .fn()
        .mockReturnValueOnce(new Date('2026-07-19T12:00:00.000Z'))
        .mockReturnValue(new Date('2026-07-19T12:06:00.000Z')),
    });

    await expect(client.getCatalog()).resolves.toBeNull();
    await expect(client.getCatalog()).resolves.toBeNull();
  });

  it('aborts a chunked oversized body without buffering it as text', async () => {
    let cancelled = false;
    const oversizedChunk = new Uint8Array(5 * 1024 * 1024 + 1);
    const body = new ReadableStream<Uint8Array>({
      start(controller): void {
        controller.enqueue(oversizedChunk);
      },
      cancel(): void {
        cancelled = true;
      },
    });
    const fetchImpl = vi.fn().mockResolvedValue(new Response(body, { status: 200 }));
    const client = createOpenRouterCatalogClient({ apiKey: 'test-key', logger, fetchImpl });

    await expect(client.getCatalog()).resolves.toBeNull();

    expect(cancelled).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'response_too_large' }),
      'OpenRouter catalog refresh failed'
    );
  });

  it('returns no Intex evidence when catalog admission is non-conformant', async () => {
    const incompleteCatalog = { data: [] };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(incompleteCatalog));
    const client = createOpenRouterCatalogClient({ apiKey: 'test-key', logger, fetchImpl });

    await expect(client.getIntexAgentCatalogEvidence()).resolves.toBeNull();
  });

  it.each(['0', '-0.000001'])(
    'excludes non-positive live prompt price %s from display metadata',
    (prompt) => {
      const liveCatalog = {
        data: [
          {
            id: 'deepseek/deepseek-v4-flash',
            context_length: 1_048_576,
            pricing: { prompt, completion: '0.000000196' },
          },
        ],
      };

      expect(createOpenRouterCatalogEntryMap(liveCatalog).has('deepseek/deepseek-v4-flash')).toBe(
        false
      );
    }
  );

  it.each(['0', '-0.000001'])(
    'excludes non-positive live completion price %s from display metadata',
    (completion) => {
      const liveCatalog = {
        data: [
          {
            id: 'deepseek/deepseek-v4-flash',
            context_length: 1_048_576,
            pricing: { prompt: '0.000000098', completion },
          },
        ],
      };

      expect(createOpenRouterCatalogEntryMap(liveCatalog).has('deepseek/deepseek-v4-flash')).toBe(
        false
      );
    }
  );

  it('ignores malformed catalog roots and entries in display metadata', () => {
    expect(createOpenRouterCatalogEntryMap(null)).toEqual(new Map());
    expect(
      createOpenRouterCatalogEntryMap({
        data: [null, { id: 123, pricing: {} }],
      })
    ).toEqual(new Map());
  });

  it('extracts available model IDs independently of optional display metadata', () => {
    const liveCatalog = {
      data: [
        { id: 'x-ai/grok-4.3', pricing: { prompt: null, completion: null } },
        { id: 'openai/gpt-5.4' },
        null,
        { id: 123 },
      ],
    };

    expect(createOpenRouterCatalogModelIdSet(liveCatalog)).toEqual(
      new Set(['x-ai/grok-4.3', 'openai/gpt-5.4'])
    );
    expect(createOpenRouterCatalogModelIdSet({ invalid: [] })).toEqual(new Set());
  });
});
