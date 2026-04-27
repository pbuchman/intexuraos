import { describe, it, expect } from 'vitest';
// @ts-expect-error vite raw import has no type declaration
import src from '../App.tsx?raw'; // @allow-missing-js -- vite '?raw' query import

describe('App.tsx lazy-loaded routes', () => {
  const source = src as string;

  it('imports every page via React.lazy', () => {
    expect(source).not.toMatch(/from '@\/pages'/);
    const lazyCount = (source.match(/React\.lazy\(/g) ?? []).length;
    expect(lazyCount).toBeGreaterThanOrEqual(30);
  });

  it('wraps routes in <Suspense fallback={<FullPageSpinner', () => {
    expect(source).toMatch(/<Suspense[^>]*fallback={<FullPageSpinner/);
  });
});
