const REACT_ROUTER_IMPORT = /import\s*\{(?<bindings>[^}]*)\}\s*from\s*['"]react-router-dom['"]/gu;

function importsBinding(source, binding) {
  for (const match of source.matchAll(REACT_ROUTER_IMPORT)) {
    const bindings = match.groups?.bindings ?? '';
    if (new RegExp(`(?:^|,)\\s*${binding}(?:\\s+as\\s+\\w+)?\\s*(?:,|$)`, 'u').test(bindings)) {
      return true;
    }
  }
  return false;
}

function findDataHashRouterVariable(source) {
  const match = /\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*createHashRouter\s*\(/u.exec(source);
  return match?.[1] ?? null;
}

export function analyzeHashRouting(source) {
  const browserHistoryRouter = /\b(?:BrowserRouter|createBrowserRouter)\b/u.test(source);
  const declarativeHash =
    importsBinding(source, 'HashRouter') && /<HashRouter(?:\s|>)/u.test(source);

  const routerVariable = findDataHashRouterVariable(source);
  const dataHash =
    importsBinding(source, 'createHashRouter') &&
    importsBinding(source, 'RouterProvider') &&
    routerVariable !== null &&
    new RegExp(
      `<RouterProvider(?:\\s|>)[^>]*\\brouter\\s*=\\s*\\{\\s*${routerVariable}\\s*\\}`,
      'su'
    ).test(source);

  const mode = declarativeHash ? 'declarative-hash' : dataHash ? 'data-hash' : null;
  return {
    mode,
    valid: mode !== null && !browserHistoryRouter,
    browserHistoryRouter,
  };
}
