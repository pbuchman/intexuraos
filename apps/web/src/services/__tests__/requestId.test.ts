import { describe, it, expect } from 'vitest';
import { newRequestId } from '@/services/requestId'; // @allow-missing-js -- Vite web app uses extensionless imports

describe('newRequestId', () => {
  it('returns a v4-shape UUID', () => {
    const id = newRequestId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
  it('returns unique ids', () => {
    expect(newRequestId()).not.toBe(newRequestId());
  });
});
