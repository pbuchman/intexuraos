// Barrel re-exports kept intentionally empty: App.tsx now imports each page
// directly via React.lazy() to enable per-route code splitting. If a future
// non-App.tsx consumer needs to import a page, prefer a direct path import
// (e.g. `import { HomePage } from '@/pages/HomePage';`) so this file does not
// become a static-import bottleneck again.
export {};
