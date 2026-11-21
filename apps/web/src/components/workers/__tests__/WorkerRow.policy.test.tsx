// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CODE_TASK_WORKER_TYPES } from '@intexuraos/code-task-domain/worker-types';
import { WorkerRow } from '../WorkerRow.js';

afterEach(cleanup);

const worker = {
  name: 'home-dev', url: 'https://example.test', cfAccessClientId: 'masked',
  cfAccessClientSecret: 'masked', dispatchSigningSecret: 'masked', enabled: true,
};
const common = { worker, priority: 1, onDelete: vi.fn(), onTest: vi.fn(), onRefreshStatus: vi.fn() };

describe('per-worker type controls', () => {
  it('turns off all Claude Code types and saves only the two Codex presets without credentials', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    render(<WorkerRow {...common} onUpdate={onUpdate} />);
    await user.click(screen.getByRole('button', { name: 'Edit worker types' }));
    await user.click(screen.getByRole('checkbox', { name: 'Claude Code' }));
    expect((screen.getByRole('checkbox', { name: 'OpenRouter Free' }) as HTMLInputElement).checked).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Save worker types' }));
    expect(onUpdate).toHaveBeenCalledWith({ enabledWorkerTypes: ['codex', 'codex-xhigh'], expectedRevision: 0, expectedRegistration: worker.url });
    expect(await screen.findByText('Worker types applied')).toBeTruthy();
  });

  it('keeps a failed edit and requires an explicit choice when the host revision changes', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn().mockRejectedValueOnce(new Error('Host unavailable')).mockResolvedValue(undefined);
    const { rerender } = render(<WorkerRow {...common} onUpdate={onUpdate} />);
    await user.click(screen.getByRole('button', { name: 'Edit worker types' }));
    await user.click(screen.getByRole('checkbox', { name: 'Claude Auto' }));
    await user.click(screen.getByRole('button', { name: 'Save worker types' }));
    expect(await screen.findByText('Host unavailable')).toBeTruthy();
    rerender(<WorkerRow {...common} worker={{ ...worker, enabledWorkerTypes: [...CODE_TASK_WORKER_TYPES], workerTypesRevision: 5 }} onUpdate={onUpdate} />);
    expect((screen.getByRole('checkbox', { name: 'Claude Auto' }) as HTMLInputElement).checked).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Keep my selection' }));
    await user.click(screen.getByRole('button', { name: 'Save worker types' }));
    expect(onUpdate).toHaveBeenLastCalledWith({ enabledWorkerTypes: CODE_TASK_WORKER_TYPES.filter((type) => type !== 'auto'), expectedRevision: 5, expectedRegistration: worker.url });
  });

  it('shows the applied Claude OAuth status separately from an active endpoint', () => {
    const { rerender } = render(<WorkerRow {...common} worker={{ ...worker, enabledWorkerTypes: ['openrouter-free'], workerTypesRevision: 1 }} onUpdate={vi.fn()} />);
    expect(screen.getByText('Claude OAuth · Disabled')).toBeTruthy();
    rerender(<WorkerRow {...common} onUpdate={vi.fn()} status={{ name: worker.name, url: worker.url, priority: 1, enabled: true, healthy: true, status: 'healthy', checkedAt: null, stale: false,
      details: { workerAuths: { claude: { status: 'expired' }, codex: { status: 'active' } } } }} />);
    expect(screen.getByText('Claude OAuth · Expired')).toBeTruthy();
  });
});
