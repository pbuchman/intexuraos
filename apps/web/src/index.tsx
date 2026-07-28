import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import * as Sentry from '@sentry/react';
import { App } from './App.js';
import { config } from './config.js';
import { buildWebSentryConfig } from './sentryConfig.js';
import './styles/index.css';

// Initialize Sentry for error tracking
Sentry.init(buildWebSentryConfig({
  dsn: config.sentryDsn,
  environment: import.meta.env['INTEXURAOS_ENVIRONMENT'] ?? 'development',
  commitSha: import.meta.env.INTEXURAOS_COMMIT_SHA,
}));

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Failed to find root element');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>
);
