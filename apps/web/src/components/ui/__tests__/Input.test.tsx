import { afterEach, describe, it, expect } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Input } from '@/components/ui/Input';

describe('Input', () => {
  afterEach(() => {
    cleanup();
  });
  it('renders with label and input element', () => {
    render(<Input label="Username" />);
    expect(screen.getByLabelText('Username')).toBeInTheDocument();
  });

  it('passes autoComplete prop to the underlying input element', () => {
    render(<Input label="Secret Field" autoComplete="new-password" />);
    const input = screen.getByLabelText('Secret Field');
    expect(input).toHaveAttribute('autocomplete', 'new-password');
  });

  it('passes type prop to the underlying input element', () => {
    render(<Input label="Password Field" type="password" />);
    const input = screen.getByLabelText('Password Field');
    expect(input).toHaveAttribute('type', 'password');
  });

  it('renders without autoComplete when not provided', () => {
    render(<Input label="Plain Field" />);
    const input = screen.getByLabelText('Plain Field');
    expect(input).not.toHaveAttribute('autocomplete');
  });

  it('displays error message when error prop is provided', () => {
    render(<Input label="Email" error="Invalid email" />);
    expect(screen.getByText('Invalid email')).toBeInTheDocument();
  });

  it('does not display error message when error is undefined', () => {
    render(<Input label="Email" />);
    expect(screen.queryByText(/invalid/i)).not.toBeInTheDocument();
  });

  it('applies custom className', () => {
    render(<Input label="Custom" className="custom-class" />);
    const input = screen.getByLabelText('Custom');
    expect(input.className).toContain('custom-class');
  });

  it('generates id from label when id not provided', () => {
    render(<Input label="First Name" />);
    const input = screen.getByLabelText('First Name');
    expect(input).toHaveAttribute('id', 'first-name');
  });

  it('uses provided id over generated one', () => {
    render(<Input label="First Name" id="custom-id" />);
    const input = screen.getByLabelText('First Name');
    expect(input).toHaveAttribute('id', 'custom-id');
  });
});
