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

  it('hides the title visually when hideTitle is true but keeps it for a11y', () => {
    render(
      <Modal open onOpenChange={vi.fn()} title="Visually Hidden Title" hideTitle>
        <div>body</div>
      </Modal>
    );
    const title = screen.getByText('Visually Hidden Title');
    expect(title.className).toContain('sr-only');
  });

  it('applies the requested size class', () => {
    render(
      <Modal open onOpenChange={vi.fn()} title="Hi" size="2xl">
        <div>body</div>
      </Modal>
    );
    expect(screen.getByRole('dialog').className).toContain('max-w-2xl');
  });

  it('uses contentClassName override when provided', () => {
    render(
      <Modal open onOpenChange={vi.fn()} title="Hi" contentClassName="custom-class">
        <div>body</div>
      </Modal>
    );
    expect(screen.getByRole('dialog').className).toBe('custom-class');
  });

  it('uses overlayClassName override when provided', () => {
    render(
      <Modal open onOpenChange={vi.fn()} title="Hi" overlayClassName="custom-overlay-class">
        <div>body</div>
      </Modal>
    );
    expect(document.querySelector('.custom-overlay-class')).toBeInTheDocument();
  });

  it('omits padding when padded is false', () => {
    render(
      <Modal open onOpenChange={vi.fn()} title="Hi" padded={false}>
        <div>body</div>
      </Modal>
    );
    expect(screen.getByRole('dialog').className).not.toContain('p-6');
  });
});
