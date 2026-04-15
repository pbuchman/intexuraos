/** @vitest-environment jsdom */
import { describe, it, expect, afterEach, vi } from 'vitest';

import { isXiaomiDevice } from '../deviceDetection.js';

function stubUserAgent(ua: string): void {
  vi.stubGlobal('navigator', { userAgent: ua });
}

describe('isXiaomiDevice', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns true for Xiaomi user agent', () => {
    stubUserAgent(
      'Mozilla/5.0 (Linux; Android 13; Xiaomi 13) AppleWebKit/537.36 Chrome/120.0',
    );
    expect(isXiaomiDevice()).toBe(true);
  });

  it('returns true for MIUI user agent', () => {
    stubUserAgent(
      'Mozilla/5.0 (Linux; Android 12; M2101K6G) AppleWebKit/537.36 MIUI/14',
    );
    expect(isXiaomiDevice()).toBe(true);
  });

  it('returns true for HyperOS user agent', () => {
    stubUserAgent(
      'Mozilla/5.0 (Linux; Android 14; 23113RKC6C) AppleWebKit/537.36 HyperOS/1.0',
    );
    expect(isXiaomiDevice()).toBe(true);
  });

  it('returns true for Redmi user agent', () => {
    stubUserAgent(
      'Mozilla/5.0 (Linux; Android 13; Redmi Note 12) AppleWebKit/537.36 Chrome/120.0',
    );
    expect(isXiaomiDevice()).toBe(true);
  });

  it('returns true for POCO user agent', () => {
    stubUserAgent(
      'Mozilla/5.0 (Linux; Android 13; POCO X5 Pro) AppleWebKit/537.36 Chrome/120.0',
    );
    expect(isXiaomiDevice()).toBe(true);
  });

  it('returns false for Chrome on Pixel', () => {
    stubUserAgent(
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0',
    );
    expect(isXiaomiDevice()).toBe(false);
  });

  it('returns false for iPhone', () => {
    stubUserAgent(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
    );
    expect(isXiaomiDevice()).toBe(false);
  });

  it('returns false for desktop Chrome', () => {
    stubUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0',
    );
    expect(isXiaomiDevice()).toBe(false);
  });

  it('returns false when navigator is undefined (SSR)', () => {
    vi.stubGlobal('navigator', undefined);
    expect(isXiaomiDevice()).toBe(false);
  });
});
