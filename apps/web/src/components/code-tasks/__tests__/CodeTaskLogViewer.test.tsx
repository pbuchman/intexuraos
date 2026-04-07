/**
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CodeTaskLogViewer } from '../CodeTaskLogViewer.js';
import type { CodeTaskLogViewerProps } from '../CodeTaskLogViewer.js';
import type { LogLine } from '@/hooks/useCodeTaskLogs.js';

afterEach(() => {
  cleanup();
});

function makeLog(sequence: number, text: string): LogLine {
  return { sequence, text };
}

function makeProps(overrides: Partial<CodeTaskLogViewerProps> = {}): CodeTaskLogViewerProps {
  return {
    logs: [],
    isActive: false,
    listenerHealthy: true,
    taskStatus: 'implemented',
    ...overrides,
  };
}

describe('CodeTaskLogViewer URL detection', () => {
  it('renders a single URL in a log line as an anchor link', () => {
    const url = 'https://example.com/path';
    const props = makeProps({
      logs: [makeLog(1, `Check this out: ${url}`)],
    });

    render(<CodeTaskLogViewer {...props} />);

    const link = screen.getByRole('link', { name: url });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', url);
  });

  it('renders multiple URLs in a single log line as separate anchor links', () => {
    const url1 = 'https://example.com/first';
    const url2 = 'https://example.com/second';
    const props = makeProps({
      logs: [makeLog(1, `First: ${url1} and second: ${url2}`)],
    });

    render(<CodeTaskLogViewer {...props} />);

    const links = screen.getAllByRole('link');
    const hrefs = links.map((l) => l.getAttribute('href'));
    expect(hrefs).toContain(url1);
    expect(hrefs).toContain(url2);
  });

  it('renders a line with no URL as plain text with no anchor elements', () => {
    const props = makeProps({
      logs: [makeLog(1, '[claude] Just a regular log line with no URL')],
    });

    render(<CodeTaskLogViewer {...props} />);

    const link = screen.queryByRole('link');
    expect(link).not.toBeInTheDocument();
  });
});

describe('CodeTaskLogViewer URL display', () => {
  it('truncates long URLs (>80 chars) in the link text using formatUrlForDisplay', () => {
    // URL > 80 chars: display = first 40 + '...' + last 30
    const longUrl =
      'https://example.com/very/long/path/that/exceeds/eighty/characters/for/sure/and/more';
    const expectedDisplay = longUrl.slice(0, 40) + '...' + longUrl.slice(-30);

    const props = makeProps({
      logs: [makeLog(1, `Link: ${longUrl}`)],
    });

    render(<CodeTaskLogViewer {...props} />);

    const link = screen.getByRole('link', { name: expectedDisplay });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', longUrl);
  });
});

describe('CodeTaskLogViewer URL attributes', () => {
  it('renders links with target="_blank" and rel="noopener noreferrer"', () => {
    const url = 'https://example.com/secure';
    const props = makeProps({
      logs: [makeLog(1, `See: ${url}`)],
    });

    render(<CodeTaskLogViewer {...props} />);

    const link = screen.getByRole('link', { name: url });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });
});

describe('CodeTaskLogViewer body lines', () => {
  it('renders links in body lines when blocks are not collapsible (< 4 visual lines)', () => {
    const url = 'https://example.com/body-uncollapsed';
    // Only 2 body lines -> not collapsible -> always expanded
    const logs: LogLine[] = [
      makeLog(1, '[tool] Run something'),
      makeLog(2, `    result: ${url}`),
      makeLog(3, '    done'),
    ];

    render(<CodeTaskLogViewer {...makeProps({ logs })} />);

    // Not collapsible (2 body lines < 4), so body is always shown
    const link = screen.getByRole('link', { name: url });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', url);
  });

  it('renders links in body lines after expanding a collapsed block', async () => {
    const url = 'https://example.com/body-link';
    // 4 body lines >= 4 -> collapsible (collapsed by default when compactMode=true)
    const logs: LogLine[] = [
      makeLog(1, '[tool] Run command'),
      makeLog(2, `    body line 1: ${url}`),
      makeLog(3, '    body line 2'),
      makeLog(4, '    body line 3'),
      makeLog(5, '    body line 4'),
    ];

    render(<CodeTaskLogViewer {...makeProps({ logs })} />);

    // Block is collapsed — the link should not be visible yet
    expect(screen.queryByRole('link', { name: url })).not.toBeInTheDocument();

    // Expand the block
    const expandButton = screen.getByRole('button', { name: /expand tool output/i });
    await userEvent.click(expandButton);

    // After expanding, body lines with the URL should now be visible
    expect(screen.getByRole('link', { name: url })).toBeInTheDocument();
  });
});

describe('CodeTaskLogViewer integration', () => {
  it('copy button still renders when logs with URLs are present', () => {
    const props = makeProps({
      logs: [makeLog(1, 'Check https://example.com/copy-test for details')],
    });

    render(<CodeTaskLogViewer {...props} />);

    // The copy button is the one that shows "Copy" (before clicking)
    const buttons = screen.getAllByRole('button');
    const copyButton = buttons.find((b) => /copy/i.test(b.textContent ?? ''));
    expect(copyButton).toBeDefined();
  });

  it('claude filter button has aria-pressed attribute', () => {
    const props = makeProps({
      logs: [makeLog(1, '[claude] Some claude output with https://example.com/filter')],
    });

    render(<CodeTaskLogViewer {...props} />);

    const buttons = screen.getAllByRole('button');
    const claudeButton = buttons.find((b) => b.textContent?.trim() === 'Claude');
    expect(claudeButton).toBeDefined();
    expect(claudeButton).toHaveAttribute('aria-pressed', 'false');
  });

  it('when claude filter is active, only claude-tagged lines (with links) are shown', async () => {
    const claudeUrl = 'https://example.com/claude-line';
    const otherUrl = 'https://example.com/other-line';
    const logs: LogLine[] = [
      makeLog(1, `[claude] Claude output: ${claudeUrl}`),
      makeLog(2, `[tool] Tool output: ${otherUrl}`),
    ];

    render(<CodeTaskLogViewer {...makeProps({ logs })} />);

    // Both links visible before filter
    expect(screen.getByRole('link', { name: claudeUrl })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: otherUrl })).toBeInTheDocument();

    // Activate the Claude filter
    const buttons = screen.getAllByRole('button');
    const claudeButton = buttons.find((b) => b.textContent?.trim() === 'Claude');
    if (claudeButton === undefined) throw new Error('Claude filter button not found');
    await userEvent.click(claudeButton);

    // Only the claude-tagged line should remain visible
    expect(screen.getByRole('link', { name: claudeUrl })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: otherUrl })).not.toBeInTheDocument();
  });

  it('collapsible blocks still work correctly when log lines contain URLs', async () => {
    const url = 'https://example.com/collapsible';
    const logs: LogLine[] = [
      makeLog(1, '[tool] Run task'),
      makeLog(2, `    output: ${url}`),
      makeLog(3, '    line 2'),
      makeLog(4, '    line 3'),
      makeLog(5, '    line 4'),
    ];

    render(<CodeTaskLogViewer {...makeProps({ logs })} />);

    // Default: compactMode=true and 4 body lines >= 4 -> collapsed
    // A "N lines hidden" button should be visible
    const hiddenLabels = screen.queryAllByText(/\d+ lines hidden/i);
    expect(hiddenLabels.length).toBeGreaterThan(0);

    // Expand the block
    const expandButton = screen.getByRole('button', { name: /expand tool output/i });
    await userEvent.click(expandButton);

    // After expanding, the body line with the URL should be visible
    expect(screen.getByRole('link', { name: url })).toBeInTheDocument();
  });
});
