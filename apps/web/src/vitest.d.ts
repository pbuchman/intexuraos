/// <reference types="vitest" />
/// <reference types="@testing-library/jest-dom" />

declare module 'vitest' {
  interface Assertion<T = unknown> extends jest.Matchers<void, T> {
    toBeInTheDocument(): T;
    toHaveAttribute(attr: string, value?: unknown): T;
    toHaveClass(...classes: string[]): T;
    toHaveValue(value: unknown): T;
    toBeDisabled(): T;
    toBeEnabled(): T;
    toHaveTextContent(text: string | RegExp): T;
    toBeVisible(): T;
  }
}
