import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Modal } from '@/components/ui/Modal';

describe('<Modal/>', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders children with aria-modal when open', () => {
    render(
      <Modal open onOpenChange={vi.fn()} title="Hi">
        <div>body</div>
      </Modal>
    );
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByText('body')).toBeInTheDocument();
    expect(screen.getByText('Hi')).toBeInTheDocument();
  });

  it('renders description when provided', () => {
    render(
      <Modal open onOpenChange={vi.fn()} title="Hi" description="A subtitle">
        <div>body</div>
      </Modal>
    );
    expect(screen.getByText('A subtitle')).toBeInTheDocument();
  });

  it('does not render dialog content when closed', () => {
    render(
      <Modal open={false} onOpenChange={vi.fn()} title="Hi">
        <div>body</div>
      </Modal>
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes on Escape', () => {
    const onOpenChange = vi.fn();
    render(
      <Modal open onOpenChange={onOpenChange} title="Hi">
        <button>focus me</button>
      </Modal>
    );
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
