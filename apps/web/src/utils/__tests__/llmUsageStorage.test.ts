/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadFromStorage, saveToStorage } from '../llmUsageStorage.js';

function isNumber(value: unknown): value is number {
  return typeof value === 'number';
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

// jsdom 26 in this environment ships a localStorage implementation that
// lacks `.clear()`, breaking `beforeEach` resets. Stub a minimal in-memory
// implementation so tests don't depend on the host's localStorage.
function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length(): number {
      return store.size;
    },
    clear(): void {
      store.clear();
    },
    getItem(key: string): string | null {
      return store.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      store.set(key, value);
    },
    removeItem(key: string): void {
      store.delete(key);
    },
    key(index: number): string | null {
      return Array.from(store.keys())[index] ?? null;
    },
  };
}

beforeEach(() => {
  vi.stubGlobal('localStorage', createMemoryStorage());
});

describe('loadFromStorage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns fallback when key does not exist', () => {
    const result = loadFromStorage('missing', isNumber, 42);
    expect(result).toBe(42);
  });

  it('returns parsed value when valid', () => {
    localStorage.setItem('count', '7');
    const result = loadFromStorage('count', isNumber, 0);
    expect(result).toBe(7);
  });

  it('returns fallback when JSON is invalid', () => {
    localStorage.setItem('bad', '{not-json');
    const result = loadFromStorage('bad', isNumber, 99);
    expect(result).toBe(99);
  });

  it('returns fallback when validator fails', () => {
    localStorage.setItem('wrong-type', '"hello"');
    const result = loadFromStorage('wrong-type', isNumber, 0);
    expect(result).toBe(0);
  });

  it('parses complex types correctly', () => {
    localStorage.setItem('arr', '["a","b","c"]');
    const result = loadFromStorage('arr', isStringArray, []);
    expect(result).toEqual(['a', 'b', 'c']);
  });
});

describe('saveToStorage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('writes JSON to localStorage', () => {
    saveToStorage('key', { hello: 'world' });
    expect(localStorage.getItem('key')).toBe('{"hello":"world"}');
  });

  it('handles quota errors gracefully', () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('quota exceeded', 'QuotaExceededError');
    });

    expect(() => saveToStorage('key', 'value')).not.toThrow();
  });
});
