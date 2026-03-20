import { describe, it, expect, beforeEach } from 'vitest';
import pino from 'pino';
import { FakeHellscriptRepository } from './fakeHellscriptRepository.js';
import { listBuffers } from '../domain/usecases/listBuffers.js';
import { getBufferWorkspace } from '../domain/usecases/getBufferWorkspace.js';
import { emptyState } from '../domain/models/materializedBufferState.js';

const logger = pino({ level: 'silent' });

describe('listBuffers', () => {
  let repository: FakeHellscriptRepository;

  beforeEach(() => {
    repository = new FakeHellscriptRepository();
  });

  it('returns buffers for user', async () => {
    await repository.createBuffer('user-1', 'Buffer 1');
    await repository.createBuffer('user-1', 'Buffer 2');
    await repository.createBuffer('user-2', 'Other');

    const result = await listBuffers({ repository, logger }, 'user-1');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(2);
    }
  });

  it('returns empty for user with no buffers', async () => {
    const result = await listBuffers({ repository, logger }, 'user-1');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual([]);
    }
  });

  it('returns error when repository fails', async () => {
    repository.simulateMethodError('listBuffers', new Error('DB error'));

    const result = await listBuffers({ repository, logger }, 'user-1');

    expect(result.ok).toBe(false);
  });
});

describe('getBufferWorkspace', () => {
  let repository: FakeHellscriptRepository;

  beforeEach(() => {
    repository = new FakeHellscriptRepository();
  });

  it('returns full workspace for existing buffer', async () => {
    const created = await repository.createBuffer('user-1', 'My Buffer');
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await repository.saveEvent({
      bufferId: created.value.id,
      rawUtterance: 'Hello',
      intent: { kind: 'append_thought', payload: { text: 'Hello' } },
      createdAt: '2024-01-01T00:00:00.000Z',
    });

    await repository.updateBufferState(
      created.value.id,
      {
        ...emptyState(),
        thoughts: [{ id: 't1', text: 'Hello', addedAt: '2024-01-01T00:00:00.000Z' }],
      },
      1
    );

    const result = await getBufferWorkspace(
      { repository, logger },
      created.value.id,
      'user-1'
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.buffer.title).toBe('Hello');
      expect(result.value.events).toHaveLength(1);
      expect(result.value.state).not.toBeNull();
    }
  });

  it('returns error for non-existent buffer', async () => {
    const result = await getBufferWorkspace(
      { repository, logger },
      'nonexistent',
      'user-1'
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Buffer not found');
    }
  });

  it('returns error for buffer owned by another user', async () => {
    const created = await repository.createBuffer('user-2', 'Other');
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const result = await getBufferWorkspace(
      { repository, logger },
      created.value.id,
      'user-1'
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Buffer not found');
    }
  });

  it('returns error when getBufferWithState fails', async () => {
    repository.simulateMethodError('getBufferWithState', new Error('DB error'));

    const result = await getBufferWorkspace(
      { repository, logger },
      'some-id',
      'user-1'
    );

    expect(result.ok).toBe(false);
  });

  it('returns error when getEvents fails', async () => {
    const created = await repository.createBuffer('user-1', 'Buffer');
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    repository.simulateMethodError('getEvents', new Error('Read failed'));

    const result = await getBufferWorkspace(
      { repository, logger },
      created.value.id,
      'user-1'
    );

    expect(result.ok).toBe(false);
  });

  it('returns error when getDraftVersions fails', async () => {
    const created = await repository.createBuffer('user-1', 'Buffer');
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    repository.simulateMethodError('getDraftVersions', new Error('Read failed'));

    const result = await getBufferWorkspace(
      { repository, logger },
      created.value.id,
      'user-1'
    );

    expect(result.ok).toBe(false);
  });
});
