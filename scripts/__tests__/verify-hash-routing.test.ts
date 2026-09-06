import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyzeHashRouting } from '../lib/hash-routing.mjs'; // @allow-missing-js -- .mjs import

const repoRoot = resolve(__dirname, '..', '..');

describe('hash-routing verifier', () => {
  it('accepts declarative HashRouter wiring', () => {
    expect(
      analyzeHashRouting(`
        import { HashRouter } from 'react-router-dom';
        export function App() { return <HashRouter><Routes /></HashRouter>; }
      `)
    ).toEqual({ mode: 'declarative-hash', valid: true, browserHistoryRouter: false });
  });

  it('accepts createHashRouter only when RouterProvider exposes the created router', () => {
    expect(
      analyzeHashRouting(`
        import { createHashRouter, RouterProvider } from 'react-router-dom';
        const router = createHashRouter([{ path: '*', element: <Routes /> }]);
        export function App() { return <RouterProvider router={router} />; }
      `)
    ).toEqual({ mode: 'data-hash', valid: true, browserHistoryRouter: false });

    expect(
      analyzeHashRouting(`
        import { createHashRouter } from 'react-router-dom';
        const router = createHashRouter([]);
      `)
    ).toEqual({ mode: null, valid: false, browserHistoryRouter: false });
  });

  it.each(['BrowserRouter', 'createBrowserRouter'])(
    'rejects browser-history routing through %s',
    (routerName) => {
      expect(
        analyzeHashRouting(`
          import { ${routerName} } from 'react-router-dom';
          import { HashRouter } from 'react-router-dom';
          export function App() { return <HashRouter />; }
        `)
      ).toMatchObject({ valid: false, browserHistoryRouter: true });
    }
  );

  it('recognizes the production Web app as data hash routing', () => {
    const source = readFileSync(resolve(repoRoot, 'apps/web/src/App.tsx'), 'utf8');

    expect(analyzeHashRouting(source)).toEqual({
      mode: 'data-hash',
      valid: true,
      browserHistoryRouter: false,
    });
  });
});
