#!/usr/bin/env node
/**
 * Terminal UI module for dev.mjs
 *
 * Provides a split-pane interface:
 * - Top: Service status panel with health indicators
 * - Bottom: Scrolling log output with filtering
 *
 * Filter controls:
 *   / or f     - Open filter input
 *   Enter      - Apply filter
 *   Escape     - Clear filter (when in filter mode) or quit
 *   c          - Clear filter (when not in filter mode)
 */

import blessed from 'blessed';

const STATUS_COLORS = {
  starting: 'yellow',
  ok: 'green',
  degraded: 'yellow',
  down: 'red',
  stopped: 'gray',
};

const STATUS_LABELS = {
  starting: 'starting...',
  ok: 'ok',
  degraded: 'degraded',
  down: 'down',
  stopped: 'stopped',
};

const MAX_LOG_BUFFER = 10000;

let screen = null;
let statusPanel = null;
let logPanel = null;
let filterInput = null;
let services = new Map();
let headerHeight = 3;

let logBuffer = [];
let currentFilter = '';
let isFilterMode = false;

export function initUI(serviceList, webApp) {
  screen = blessed.screen({
    smartCSR: true,
    title: 'IntexuraOS Development',
    fullUnicode: true,
  });

  const allServices = [...serviceList, webApp];
  for (const svc of allServices) {
    services.set(svc.name, { ...svc, status: 'starting' });
  }

  const rowCount = Math.ceil(allServices.length / 2);
  const statusHeight = rowCount + headerHeight + 2;
  const filterBarHeight = 3;

  statusPanel = blessed.box({
    parent: screen,
    top: 0,
    left: 0,
    width: '100%',
    height: statusHeight,
    border: { type: 'line' },
    style: {
      border: { fg: 'cyan' },
    },
    label: ' IntexuraOS Development Environment ',
    tags: true,
  });

  logPanel = blessed.log({
    parent: screen,
    top: statusHeight,
    left: 0,
    width: '100%',
    height: `100%-${statusHeight + filterBarHeight}`,
    border: { type: 'line' },
    style: {
      border: { fg: 'blue' },
    },
    label: ' Logs (press / to filter) ',
    tags: true,
    scrollable: true,
    alwaysScroll: true,
    scrollbar: {
      ch: ' ',
      track: { bg: 'gray' },
      style: { bg: 'white' },
    },
    mouse: true,
    keys: true,
    vi: true,
  });

  filterInput = blessed.textbox({
    parent: screen,
    bottom: 0,
    left: 0,
    width: '100%',
    height: filterBarHeight,
    border: { type: 'line' },
    style: {
      border: { fg: 'gray' },
      focus: {
        border: { fg: 'yellow' },
      },
    },
    label: ' Filter ',
    tags: true,
    inputOnFocus: true,
  });

  filterInput.on('submit', (value) => {
    currentFilter = value.trim().toLowerCase();
    isFilterMode = false;
    filterInput.clearValue();
    screen.focusNext();
    applyFilter();
  });

  filterInput.on('cancel', () => {
    isFilterMode = false;
    filterInput.clearValue();
    screen.focusNext();
    updateFilterLabel();
    screen.render();
  });

  screen.key(['/', 'f'], () => {
    if (!isFilterMode) {
      isFilterMode = true;
      filterInput.focus();
      filterInput.setLabel(' Filter (Enter to apply, Esc to cancel) ');
      filterInput.style.border.fg = 'yellow';
      screen.render();
    }
  });

  screen.key(['c'], () => {
    if (!isFilterMode && currentFilter) {
      clearFilter();
    }
  });

  screen.key(['escape'], () => {
    if (isFilterMode) {
      isFilterMode = false;
      filterInput.clearValue();
      screen.focusNext();
      updateFilterLabel();
      screen.render();
    } else {
      return process.kill(process.pid, 'SIGINT');
    }
  });

  screen.key(['q', 'C-c'], () => {
    if (!isFilterMode) {
      return process.kill(process.pid, 'SIGINT');
    }
  });

  screen.key(['up', 'k'], () => {
    if (!isFilterMode) {
      logPanel.scroll(-1);
      screen.render();
    }
  });

  screen.key(['down', 'j'], () => {
    if (!isFilterMode) {
      logPanel.scroll(1);
      screen.render();
    }
  });

  screen.key(['pageup'], () => {
    if (!isFilterMode) {
      logPanel.scroll(-logPanel.height + 2);
      screen.render();
    }
  });

  screen.key(['pagedown'], () => {
    if (!isFilterMode) {
      logPanel.scroll(logPanel.height - 2);
      screen.render();
    }
  });

  renderStatusPanel();
  updateFilterLabel();
  screen.render();

  return { screen, statusPanel, logPanel };
}

function updateFilterLabel() {
  if (!filterInput) return;

  if (currentFilter) {
    filterInput.setLabel(` Filter: "${currentFilter}" (c to clear) `);
    filterInput.style.border.fg = 'green';
    logPanel.setLabel(` Logs [filtered: "${currentFilter}"] `);
    logPanel.style.border.fg = 'green';
  } else {
    filterInput.setLabel(' Filter (press / or f) ');
    filterInput.style.border.fg = 'gray';
    logPanel.setLabel(' Logs (press / to filter) ');
    logPanel.style.border.fg = 'blue';
  }
}

function stripTags(text) {
  return text.replace(/\{[^}]+\}/g, '');
}

function matchesFilter(line) {
  if (!currentFilter) return true;
  const plainText = stripTags(line).toLowerCase();
  return plainText.includes(currentFilter);
}

function applyFilter() {
  if (!logPanel) return;

  logPanel.setContent('');

  const filteredLogs = logBuffer.filter(matchesFilter);
  for (const line of filteredLogs) {
    logPanel.log(line);
  }

  updateFilterLabel();
  logPanel.setScrollPerc(100);
  screen.render();
}

function clearFilter() {
  currentFilter = '';
  applyFilter();
}

function formatServiceEntry(name, svc) {
  const status = svc.status || 'starting';
  const color = STATUS_COLORS[status] || 'white';
  const label = STATUS_LABELS[status] || status;

  const namePadded = name.padEnd(28);
  const portStr = String(svc.port).padStart(4);
  const statusFormatted = `{${color}-fg}[${label}]{/${color}-fg}`;

  return `${namePadded} ${portStr} ${statusFormatted}`;
}

function renderStatusPanel() {
  if (!statusPanel) return;

  const colWidth = 48;
  const header =
    '{bold}SERVICE                      PORT STATUS     {/bold}' +
    ' ' +
    '{bold}SERVICE                      PORT STATUS     {/bold}';
  const separator = '─'.repeat(colWidth) + '┬' + '─'.repeat(colWidth);

  const lines = [header, separator];

  const serviceEntries = Array.from(services.entries());
  const rowCount = Math.ceil(serviceEntries.length / 2);

  for (let i = 0; i < rowCount; i++) {
    const leftIdx = i;
    const rightIdx = i + rowCount;

    let row = '';

    if (leftIdx < serviceEntries.length) {
      const [name, svc] = serviceEntries[leftIdx];
      row += formatServiceEntry(name, svc).padEnd(colWidth);
    } else {
      row += ' '.repeat(colWidth);
    }

    row += '│';

    if (rightIdx < serviceEntries.length) {
      const [name, svc] = serviceEntries[rightIdx];
      row += formatServiceEntry(name, svc);
    }

    lines.push(row);
  }

  statusPanel.setContent(lines.join('\n'));
  if (screen) screen.render();
}

export function updateServiceStatus(serviceName, status) {
  const svc = services.get(serviceName);
  if (svc) {
    svc.status = status;
    renderStatusPanel();
  }
}

export function appendLog(line) {
  logBuffer.push(line);

  if (logBuffer.length > MAX_LOG_BUFFER) {
    logBuffer = logBuffer.slice(-MAX_LOG_BUFFER);
  }

  if (logPanel) {
    if (matchesFilter(line)) {
      logPanel.log(line);
    }
  } else {
    console.log(line);
  }
}

export function destroy() {
  if (screen) {
    screen.destroy();
    screen = null;
    statusPanel = null;
    logPanel = null;
    filterInput = null;
  }
  logBuffer = [];
  currentFilter = '';
  isFilterMode = false;
}

export function isActive() {
  return screen !== null;
}

export async function pollHealth(serviceList, webApp) {
  const allServices = [...serviceList, webApp];

  for (const svc of allServices) {
    if (svc.name === 'web') {
      try {
        const res = await fetch(`http://localhost:${svc.port}`, {
          signal: AbortSignal.timeout(2000),
        });
        updateServiceStatus(svc.name, res.ok ? 'ok' : 'down');
      } catch {
        updateServiceStatus(svc.name, 'down');
      }
      continue;
    }

    try {
      const res = await fetch(`http://localhost:${svc.port}/health`, {
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok) {
        const data = await res.json();
        updateServiceStatus(svc.name, data.status || 'ok');
      } else {
        updateServiceStatus(svc.name, 'down');
      }
    } catch {
      updateServiceStatus(svc.name, 'down');
    }
  }
}
