import { afterEach, describe, expect, it, vi } from 'vitest';
import { createExternalSaveClient } from '../../../infra/http/externalSaveClient.js';

describe('createExternalSaveClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts external-save payloads with Cloudflare Access service auth headers', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchFn = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response('accepted', { status: 201, statusText: 'Created' });
    };
    const client = createExternalSaveClient({
      endpointUrl: 'https://external-save.example.com/intex',
      cfAccessClientId: 'cf-client-id',
      cfAccessClientSecret: 'cf-client-secret',
      source: 'ios-shortcuts',
      fetchFn: fetchFn as typeof fetch,
    });

    const result = await client.save({
      message: 'Save externally this LinkedIn note',
      sourceUrl: 'https://example.com/post',
    });

    expect(result).toEqual({
      ok: true,
      value: { status: 'completed', message: 'Saved externally' },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://external-save.example.com/intex');
    expect(calls[0]?.init).toMatchObject({
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'CF-Access-Client-Id': 'cf-client-id',
        'CF-Access-Client-Secret': 'cf-client-secret',
      },
    });
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      source: 'ios-shortcuts',
      message: 'Save externally this LinkedIn note',
      source_url: 'https://example.com/post',
    });
  });

  it('omits source_url when no source URL is provided', async () => {
    const calls: RequestInit[] = [];
    const fetchFn = async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      calls.push(init ?? {});
      return new Response('', { status: 200, statusText: 'OK' });
    };
    const client = createExternalSaveClient({
      endpointUrl: 'https://external-save.example.com/intex',
      cfAccessClientId: 'cf-client-id',
      cfAccessClientSecret: 'cf-client-secret',
      source: 'ios-shortcuts',
      fetchFn: fetchFn as typeof fetch,
    });

    await client.save({ message: 'Upload externally this note' });

    expect(JSON.parse(String(calls[0]?.body))).toEqual({
      source: 'ios-shortcuts',
      message: 'Upload externally this note',
    });
  });

  it('uses global fetch when a fetch function is not injected', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      async (url: string | URL | Request): Promise<Response> => {
        calls.push(String(url));
        return new Response('', { status: 200, statusText: 'OK' });
      }
    );
    const client = createExternalSaveClient({
      endpointUrl: 'https://external-save.example.com/intex',
      cfAccessClientId: 'cf-client-id',
      cfAccessClientSecret: 'cf-client-secret',
      source: 'ios-shortcuts',
    });

    await expect(client.save({ message: 'Save externally this note' })).resolves.toEqual({
      ok: true,
      value: { status: 'completed', message: 'Saved externally' },
    });
    expect(calls).toEqual(['https://external-save.example.com/intex']);
  });

  it('returns an error result for non-2xx responses', async () => {
    const client = createExternalSaveClient({
      endpointUrl: 'https://external-save.example.com/intex',
      cfAccessClientId: 'cf-client-id',
      cfAccessClientSecret: 'cf-client-secret',
      source: 'ios-shortcuts',
      fetchFn: (async () =>
        new Response('forbidden', { status: 403, statusText: 'Forbidden' })) as typeof fetch,
    });

    const result = await client.save({ message: 'Save externally this note' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({
        code: 'HTTP_ERROR',
        message: 'HTTP 403: Forbidden',
      });
    }
  });

  it('returns an error result when the request throws', async () => {
    const client = createExternalSaveClient({
      endpointUrl: 'https://external-save.example.com/intex',
      cfAccessClientId: 'cf-client-id',
      cfAccessClientSecret: 'cf-client-secret',
      source: 'ios-shortcuts',
      fetchFn: (async () => {
        throw new Error('network down');
      }) as typeof fetch,
    });

    const result = await client.save({ message: 'Save externally this note' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({
        code: 'NETWORK_ERROR',
        message: 'network down',
      });
    }
  });
});
