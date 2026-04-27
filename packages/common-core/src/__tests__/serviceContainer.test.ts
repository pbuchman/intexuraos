/**
 * Tests for the createServiceContainer DI factory.
 */
import { describe, it, expect } from 'vitest';
import { createServiceContainer } from '../serviceContainer.js';

interface Deps {
  foo: string;
  bar: number;
}

describe('createServiceContainer', () => {
  it('throws from get() before init', () => {
    const handle = createServiceContainer<Deps>(() => ({ foo: 'a', bar: 1 }));
    expect(() => handle.get()).toThrow(/not initialized/);
  });

  it('throws from set() before init', () => {
    const handle = createServiceContainer<Deps>(() => ({ foo: 'a', bar: 1 }));
    expect(() => handle.set({ foo: 'x' })).toThrow(/not initialized/);
  });

  it('init() then get() returns the container produced by the factory', () => {
    const handle = createServiceContainer<Deps>(() => ({ foo: 'a', bar: 1 }));
    handle.init();
    expect(handle.get()).toEqual({ foo: 'a', bar: 1 });
  });

  it('init() invokes the factory each call (rebuilds the container)', () => {
    let calls = 0;
    const handle = createServiceContainer<Deps>(() => {
      calls += 1;
      return { foo: 'a', bar: calls };
    });
    handle.init();
    handle.init();
    expect(handle.get().bar).toBe(2);
  });

  it('set() merges a partial override into the existing container', () => {
    const handle = createServiceContainer<Deps>(() => ({ foo: 'a', bar: 1 }));
    handle.init();
    handle.set({ foo: 'b' });
    expect(handle.get()).toEqual({ foo: 'b', bar: 1 });
  });

  it('reset() clears the container so subsequent get() throws', () => {
    const handle = createServiceContainer<Deps>(() => ({ foo: 'a', bar: 1 }));
    handle.init();
    handle.reset();
    expect(() => handle.get()).toThrow(/not initialized/);
  });

  it('passes config through to the factory', () => {
    interface Cfg {
      n: number;
    }
    const handle = createServiceContainer<Deps, Cfg>((cfg) => ({
      foo: 'a',
      bar: cfg.n,
    }));
    handle.init({ n: 42 });
    expect(handle.get().bar).toBe(42);
  });

  it('factory may treat config as optional via void generic parameter', () => {
    const handle = createServiceContainer<Deps>(() => ({ foo: 'a', bar: 7 }));
    handle.init();
    expect(handle.get().bar).toBe(7);
  });
});
