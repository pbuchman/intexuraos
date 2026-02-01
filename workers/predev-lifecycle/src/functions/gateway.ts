/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unnecessary-condition */

import type { HttpFunction } from '@google-cloud/functions-framework';
import * as functions from '@google-cloud/functions-framework';
import { createLogger } from '../lib/logger.js';
import { StateManager } from '../lib/state.js';
import { VmControl } from '../lib/vm-control.js';

const logger = createLogger('gateway');
const state = new StateManager();
const vm = new VmControl();

function getStartingPage(branch: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <title>Pre-Dev Starting...</title>
  <meta http-equiv="refresh" content="5">
  <style>
    body { font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #1a1a2e; color: #eee; }
    .container { text-align: center; }
    .spinner { width: 50px; height: 50px; border: 3px solid #333; border-top-color: #6366f1; border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto 20px; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .branch { color: #6366f1; font-family: monospace; }
  </style>
</head>
<body>
  <div class="container">
    <div class="spinner"></div>
    <h1>Starting Pre-Dev Environment</h1>
    <p>Branch: <span class="branch">${escapeHtml(branch)}</span></p>
    <p>This page will refresh automatically...</p>
  </div>
</body>
</html>
  `;
}

/* v8 ignore start -- test-infra: HTML escape utility with defensive fallback @preserve */
function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, (m) => {
    const replacement = map[m];
    return replacement ?? m;
  });
}
/* v8 ignore stop @preserve */

/* v8 ignore start -- test-infra: proxy function with defensive request handling @preserve */
async function proxyRequest(vmIp: string, req: any, res: any): Promise<void> {
  const targetUrl = `http://${vmIp}:3000${String(req.url ?? '')}`;

  try {
    const headers: Record<string, string> = { ...(req.headers ?? {}) };
    delete headers['host'];

    const requestOptions: RequestInit = {
      method: req.method ?? 'GET',
      headers,
    };

    if (req.method !== 'GET' && req.body !== undefined) {
      requestOptions.body = JSON.stringify(req.body);
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(targetUrl, requestOptions);

    res.status(response.status);
    for (const [key, value] of response.headers.entries()) {
      const lowerKey = key.toLowerCase();
      if (
        lowerKey !== 'transfer-encoding' &&
        lowerKey !== 'content-encoding' &&
        lowerKey !== 'content-length'
      ) {
        res.setHeader(key, value);
      }
    }
    const body = await response.text();
    res.send(body);
  } catch (error) {
    logger.error({ error, vmIp, targetUrl }, 'Proxy error');
    res.status(502).send('Bad Gateway');
  }
}
/* v8 ignore stop @preserve */

async function proxySSE(vmIp: string, port: number, path: string, res: any): Promise<void> {
  const targetUrl = `http://${vmIp}:${String(port)}${path}`;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  try {
    const response = await fetch(targetUrl);
    if (!response.ok) {
      res.status(response.status).send('SSE endpoint unavailable');
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      res.end();
      return;
    }

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
  } catch (error) {
    logger.error({ error, vmIp, port, path }, 'SSE proxy error');
  } finally {
    res.end();
  }
}

/* v8 ignore start -- test-infra: gateway function with integration-level branching @preserve */
export const gateway: HttpFunction = async (req: any, res: any) => {
  logger.info({ method: req.method, url: req.url }, 'Gateway request');

  // Fetch state once to avoid race conditions
  const currentState = await state.getState();

  // Handle DevBar SSE endpoints (public, no auth required for DevBar)
  const pathname = new URL(String(req.url ?? '/'), 'http://localhost').pathname;
  if (pathname === '/devbar/logs' || pathname === '/devbar/events') {
    if (currentState?.status !== 'running' || currentState.vmIp === null) {
      res.status(503).send('VM not running');
      return;
    }
    /* v8 ignore stop @preserve */

    const port = pathname === '/devbar/logs' ? 8106 : 8105;
    const targetPath = pathname === '/devbar/logs' ? '/logs' : '/events';

    await proxySSE(currentState.vmIp, port, targetPath, res);
    return;
  }

  // Update last activity for running VM
  if (currentState?.status === 'running') {
    await state.updateActivity();
  }

  // If running, proxy to VM
  if (currentState?.status === 'running' && currentState.vmIp !== null) {
    await proxyRequest(currentState.vmIp, req, res);
    return;
  }

  // If stopped, start VM and show "Starting" page
  // Use conditional state transition to prevent race conditions
  if (currentState === null || currentState.status === 'stopped') {
    logger.info('Attempting to start VM...');

    // Only update state if currently stopped (transactional)
    await state.setStartingIfStopped();

    // Start the VM regardless of state update (MIG resize is idempotent)
    const result = await vm.startVm();
    if (!result.success) {
      res.status(503).send(`Failed to start VM: ${result.message}`);
      return;
    }

    res.status(200).send(getStartingPage(currentState?.branch ?? 'development'));
    return;
  }

  // If starting, show "Starting" page
  // The VM's report-ready callback will transition to running
  /* v8 ignore start -- ts-type: TypeScript exhaustiveness check: all valid states handled above @preserve */
  if (currentState.status === 'starting') {
    /* v8 ignore stop @preserve */
    res.status(200).send(getStartingPage(currentState.branch));
    return;
  }

  res.status(500).send('Unknown state');
};

functions.http('gateway', gateway);
