/**
 * makeHttpRequest / makeHttpResponse — minimal Express-compatible stubs for
 * Cloud Function HTTP-triggered handlers (`vm-lifecycle`).
 *
 * The functions-framework Express types are wide and contain dozens of
 * methods we never call. Rather than mock the entire surface, the stubs
 * expose only the fields/methods the workers actually use, plus `_status` /
 * `_body` capture slots so tests can assert what the handler sent.
 */
import type { Request, Response } from '@google-cloud/functions-framework';

export interface HttpRequestInit {
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
  body?: unknown;
  url?: string;
}

export function makeHttpRequest(init: HttpRequestInit = {}): Request {
  return {
    method: init.method ?? 'POST',
    headers: init.headers ?? {},
    body: init.body ?? {},
    url: init.url ?? '/',
  } as unknown as Request;
}

export interface CapturedHttpResponse {
  _status?: number;
  _body?: unknown;
  _headers: Record<string, string>;
}

export type FakeResponse = Response & CapturedHttpResponse;

export function makeHttpResponse(): FakeResponse {
  const res = {
    _headers: {} as Record<string, string>,
  } as FakeResponse;
  res.status = (code: number): FakeResponse => {
    res._status = code;
    return res;
  };
  res.json = (body: unknown): FakeResponse => {
    res._body = body;
    return res;
  };
  res.send = (body: unknown): FakeResponse => {
    res._body = body;
    return res;
  };
  res.setHeader = (name: string, value: string): FakeResponse => {
    res._headers[name] = value;
    return res;
  };
  return res;
}
