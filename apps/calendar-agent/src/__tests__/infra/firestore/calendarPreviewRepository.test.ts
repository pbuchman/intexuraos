/**
 * Tests for CalendarPreviewRepository.
 * Uses mocked Firestore from @intexuraos/infra-firestore.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isOk, isErr } from '@intexuraos/common-core';
import {
  getCalendarPreviewByActionId,
  createCalendarPreview,
  updateCalendarPreview,
  createCalendarPreviewRepository,
} from '../../../infra/firestore/calendarPreviewRepository.js';

vi.mock('@intexuraos/infra-firestore', () => ({
  getFirestore: vi.fn(),
}));

const { getFirestore } = await import('@intexuraos/infra-firestore');

const mockDocSnapshot = {
  exists: true,
  data: vi.fn(),
};

describe('CalendarPreviewRepository', () => {
  const mockDb = {
    collection: vi.fn(() => ({
      doc: vi.fn(() => ({
        set: vi.fn(),
        get: vi.fn(() => Promise.resolve(mockDocSnapshot)),
        update: vi.fn(),
      })),
    })),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDocSnapshot.exists = true;
    mockDocSnapshot.data.mockReturnValue({
      actionId: 'action-123',
      userId: 'user-456',
      status: 'ready',
      summary: 'Lunch with Monika',
      start: '2025-01-15T14:00:00',
      end: '2025-01-15T15:00:00',
      location: 'Restaurant',
      description: null,
      duration: '1 hour',
      isAllDay: false,
      reasoning: 'User requested lunch at 2pm',
      generatedAt: '2025-01-15T10:00:00Z',
    });
    vi.mocked(getFirestore).mockReturnValue(mockDb as unknown as ReturnType<typeof getFirestore>);
  });

  describe('getCalendarPreviewByActionId', () => {
    it('returns preview when found', async () => {
      const result = await getCalendarPreviewByActionId('action-123');

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value).not.toBeNull();
        expect(result.value?.actionId).toBe('action-123');
        expect(result.value?.userId).toBe('user-456');
        expect(result.value?.status).toBe('ready');
        expect(result.value?.summary).toBe('Lunch with Monika');
        expect(result.value?.start).toBe('2025-01-15T14:00:00');
        expect(result.value?.end).toBe('2025-01-15T15:00:00');
        expect(result.value?.location).toBe('Restaurant');
        expect(result.value?.duration).toBe('1 hour');
        expect(result.value?.isAllDay).toBe(false);
      }
    });

    it('returns null when preview not found', async () => {
      mockDocSnapshot.exists = false;

      const result = await getCalendarPreviewByActionId('non-existent');

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value).toBeNull();
      }
    });

    it('returns error when Firestore throws', async () => {
      mockDb.collection.mockImplementation(() => {
        throw new Error('Firestore unavailable');
      });

      const result = await getCalendarPreviewByActionId('action-123');

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toContain('Firestore unavailable');
      }
    });

    it('uses actionId as document ID for lookup', async () => {
      const mockDocFn = vi.fn(() => ({
        set: vi.fn(),
        get: vi.fn(() => Promise.resolve(mockDocSnapshot)),
        update: vi.fn(),
      }));
      mockDb.collection.mockReturnValue({ doc: mockDocFn } as unknown as ReturnType<typeof mockDb.collection>);

      await getCalendarPreviewByActionId('specific-action-id');

      expect(mockDocFn).toHaveBeenCalledWith('specific-action-id');
    });
  });

  describe('createCalendarPreview', () => {
    it('creates preview with all fields successfully', async () => {
      const mockSet = vi.fn().mockResolvedValue(undefined);
      mockDb.collection.mockReturnValue({
        doc: vi.fn(() => ({ set: mockSet, get: vi.fn(), update: vi.fn() })),
      } as unknown as ReturnType<typeof mockDb.collection>);

      const input = {
        actionId: 'action-123',
        userId: 'user-456',
        status: 'ready' as const,
        summary: 'Lunch with Monika',
        start: '2025-01-15T14:00:00',
        end: '2025-01-15T15:00:00',
        location: 'Restaurant',
        description: 'Business lunch',
        duration: '1 hour',
        isAllDay: false,
        reasoning: 'User requested lunch at 2pm',
      };

      const result = await createCalendarPreview(input);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.actionId).toBe('action-123');
        expect(result.value.userId).toBe('user-456');
        expect(result.value.status).toBe('ready');
        expect(result.value.summary).toBe('Lunch with Monika');
        expect(result.value.generatedAt).toBeDefined();
      }
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          actionId: 'action-123',
          userId: 'user-456',
          status: 'ready',
          summary: 'Lunch with Monika',
        })
      );
    });

    it('creates pending preview with minimal fields', async () => {
      const mockSet = vi.fn().mockResolvedValue(undefined);
      mockDb.collection.mockReturnValue({
        doc: vi.fn(() => ({ set: mockSet, get: vi.fn(), update: vi.fn() })),
      } as unknown as ReturnType<typeof mockDb.collection>);

      const input = {
        actionId: 'action-123',
        userId: 'user-456',
        status: 'pending' as const,
      };

      const result = await createCalendarPreview(input);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.actionId).toBe('action-123');
        expect(result.value.status).toBe('pending');
        expect(result.value.summary).toBeUndefined();
      }
    });

    it('creates failed preview with error', async () => {
      const mockSet = vi.fn().mockResolvedValue(undefined);
      mockDb.collection.mockReturnValue({
        doc: vi.fn(() => ({ set: mockSet, get: vi.fn(), update: vi.fn() })),
      } as unknown as ReturnType<typeof mockDb.collection>);

      const input = {
        actionId: 'action-123',
        userId: 'user-456',
        status: 'failed' as const,
        error: 'Could not parse date',
      };

      const result = await createCalendarPreview(input);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.status).toBe('failed');
        expect(result.value.error).toBe('Could not parse date');
      }
    });

    it('uses actionId as document ID', async () => {
      const mockDocFn = vi.fn(() => ({ set: vi.fn().mockResolvedValue(undefined), get: vi.fn(), update: vi.fn() }));
      mockDb.collection.mockReturnValue({ doc: mockDocFn } as unknown as ReturnType<typeof mockDb.collection>);

      await createCalendarPreview({
        actionId: 'my-action-id',
        userId: 'user-456',
        status: 'pending',
      });

      expect(mockDocFn).toHaveBeenCalledWith('my-action-id');
    });

    it('returns error when Firestore throws', async () => {
      mockDb.collection.mockImplementation(() => {
        throw new Error('Firestore write error');
      });

      const result = await createCalendarPreview({
        actionId: 'action-123',
        userId: 'user-456',
        status: 'pending',
      });

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toContain('Firestore write error');
      }
    });

    it('returns error when set fails', async () => {
      mockDb.collection.mockReturnValue({
        doc: vi.fn(() => ({
          set: vi.fn().mockRejectedValue(new Error('Set failed')),
          get: vi.fn(),
          update: vi.fn(),
        })),
      } as unknown as ReturnType<typeof mockDb.collection>);

      const result = await createCalendarPreview({
        actionId: 'action-123',
        userId: 'user-456',
        status: 'pending',
      });

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toContain('Set failed');
      }
    });
  });

  describe('updateCalendarPreview', () => {
    it('updates preview status successfully', async () => {
      const mockUpdate = vi.fn().mockResolvedValue(undefined);
      mockDb.collection.mockReturnValue({
        doc: vi.fn(() => ({ set: vi.fn(), get: vi.fn(), update: mockUpdate })),
      } as unknown as ReturnType<typeof mockDb.collection>);

      const result = await updateCalendarPreview('action-123', {
        status: 'ready',
        summary: 'Updated Event',
      });

      expect(isOk(result)).toBe(true);
      expect(mockUpdate).toHaveBeenCalledWith({
        status: 'ready',
        summary: 'Updated Event',
      });
    });

    it('only updates provided fields', async () => {
      const mockUpdate = vi.fn().mockResolvedValue(undefined);
      mockDb.collection.mockReturnValue({
        doc: vi.fn(() => ({ set: vi.fn(), get: vi.fn(), update: mockUpdate })),
      } as unknown as ReturnType<typeof mockDb.collection>);

      await updateCalendarPreview('action-123', {
        status: 'failed',
        error: 'Parse error',
      });

      expect(mockUpdate).toHaveBeenCalledWith({
        status: 'failed',
        error: 'Parse error',
      });
    });

    it('uses actionId as document ID', async () => {
      const mockDocFn = vi.fn(() => ({ set: vi.fn(), get: vi.fn(), update: vi.fn().mockResolvedValue(undefined) }));
      mockDb.collection.mockReturnValue({ doc: mockDocFn } as unknown as ReturnType<typeof mockDb.collection>);

      await updateCalendarPreview('specific-action-id', { status: 'ready' });

      expect(mockDocFn).toHaveBeenCalledWith('specific-action-id');
    });

    it('returns error when Firestore throws', async () => {
      mockDb.collection.mockImplementation(() => {
        throw new Error('Firestore update error');
      });

      const result = await updateCalendarPreview('action-123', { status: 'ready' });

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toContain('Firestore update error');
      }
    });

    it('returns error when update fails', async () => {
      mockDb.collection.mockReturnValue({
        doc: vi.fn(() => ({
          set: vi.fn(),
          get: vi.fn(),
          update: vi.fn().mockRejectedValue(new Error('Update failed')),
        })),
      } as unknown as ReturnType<typeof mockDb.collection>);

      const result = await updateCalendarPreview('action-123', { status: 'ready' });

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toContain('Update failed');
      }
    });
  });

  describe('createCalendarPreviewRepository factory', () => {
    it('returns repository with getByActionId method', () => {
      const repository = createCalendarPreviewRepository();

      expect(repository.getByActionId).toBeDefined();
      expect(typeof repository.getByActionId).toBe('function');
    });

    it('returns repository with create method', () => {
      const repository = createCalendarPreviewRepository();

      expect(repository.create).toBeDefined();
      expect(typeof repository.create).toBe('function');
    });

    it('returns repository with update method', () => {
      const repository = createCalendarPreviewRepository();

      expect(repository.update).toBeDefined();
      expect(typeof repository.update).toBe('function');
    });
  });
});
