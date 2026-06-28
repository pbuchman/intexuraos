import { describe, expect, it } from 'vitest';
import {
  MAX_PROMPT_PREFERENCE_ITEMS,
  MAX_RENDERED_PROMPT_PREFERENCES_LENGTH,
  addPromptPreferenceItem,
  assertExpectedPromptPreferenceVersion,
  deletePromptPreferenceItem,
  emptyPromptPreferences,
  normalizePromptPreferenceText,
  renderPromptPreferenceBlock,
  updatePromptPreferenceItem,
} from '../../domain/preferences/promptPreferences.js';

const webActor = { actor: 'web_ui' as const, userId: 'user-1' };

describe('prompt preferences domain', () => {
  it('builds an empty current state without persisting a prompt block', () => {
    expect(emptyPromptPreferences('user-1')).toEqual({
      userId: 'user-1',
      schemaVersion: 1,
      currentVersion: 0,
      items: [],
      renderedPromptBlock: '',
      createdAt: null,
      updatedAt: null,
      updatedBy: null,
    });
  });

  it('renders deterministic prompt blocks with stable ids and quoted text', () => {
    const block = renderPromptPreferenceBlock(3, [
      {
        id: 'pref_abc123',
        text: 'When I ask to invite Jakub, invite jakub@gmail.com.',
        createdAt: '2026-06-28T10:00:00.000Z',
        updatedAt: '2026-06-28T10:00:00.000Z',
      },
      {
        id: 'pref_def456',
        text: 'When I ask about a decision, be helpful but criticize my choices.',
        createdAt: '2026-06-28T10:01:00.000Z',
        updatedAt: '2026-06-28T10:01:00.000Z',
      },
    ]);

    expect(block).toBe(
      [
        'User Preferences v3:',
        '1. (id: pref_abc123) "When I ask to invite Jakub, invite jakub@gmail.com."',
        '2. (id: pref_def456) "When I ask about a decision, be helpful but criticize my choices."',
      ].join('\n')
    );
  });

  it('escapes quotes inside row text without allowing fake rows', () => {
    const block = renderPromptPreferenceBlock(1, [
      {
        id: 'pref_quote',
        text: 'Use the label "Jakub primary".',
        createdAt: '2026-06-28T10:00:00.000Z',
        updatedAt: '2026-06-28T10:00:00.000Z',
      },
    ]);

    expect(block).toBe('User Preferences v1:\n1. (id: pref_quote) "Use the label \\"Jakub primary\\"."');
  });

  it('normalizes preference text to one line', () => {
    expect(normalizePromptPreferenceText('  Invite   Jakub   via   jakub@gmail.com.  ')).toBe(
      'Invite Jakub via jakub@gmail.com.'
    );
  });

  it('rejects empty, overlong, newline, and control-character text', () => {
    expect(() => normalizePromptPreferenceText('   ')).toThrow('Preference text cannot be empty');
    expect(() => normalizePromptPreferenceText('a'.repeat(501))).toThrow(
      'Preference text must be at most 500 characters'
    );
    expect(() => normalizePromptPreferenceText('first\nsecond')).toThrow(
      'Preference text cannot contain newlines or control characters'
    );
    expect(() => normalizePromptPreferenceText('first\tsecond')).toThrow(
      'Preference text cannot contain newlines or control characters'
    );
  });

  it('adds, updates, and deletes rows while preserving version snapshots', () => {
    const added = addPromptPreferenceItem(emptyPromptPreferences('user-1'), {
      id: 'pref_jakub',
      text: 'When I ask to invite Jakub, invite jakub@gmail.com.',
      now: '2026-06-28T10:00:00.000Z',
      updatedBy: webActor,
    });

    expect(added.current.currentVersion).toBe(1);
    expect(added.current.renderedPromptBlock).toContain('User Preferences v1:');
    expect(added.version).toMatchObject({
      id: 'user-1_1',
      userId: 'user-1',
      version: 1,
      changeType: 'add',
      changedItemId: 'pref_jakub',
      nextText: 'When I ask to invite Jakub, invite jakub@gmail.com.',
      itemCount: 1,
    });

    const updated = updatePromptPreferenceItem(added.current, {
      itemId: 'pref_jakub',
      text: 'When I ask to invite Jakub, invite jakub.nowak@gmail.com.',
      now: '2026-06-28T10:01:00.000Z',
      updatedBy: webActor,
    });

    expect(updated.current.items.map((item) => item.id)).toEqual(['pref_jakub']);
    expect(updated.version).toMatchObject({
      version: 2,
      changeType: 'update',
      previousText: 'When I ask to invite Jakub, invite jakub@gmail.com.',
      nextText: 'When I ask to invite Jakub, invite jakub.nowak@gmail.com.',
    });

    const deleted = deletePromptPreferenceItem(updated.current, {
      itemId: 'pref_jakub',
      now: '2026-06-28T10:02:00.000Z',
      updatedBy: webActor,
    });

    expect(deleted.current).toMatchObject({
      currentVersion: 3,
      items: [],
      renderedPromptBlock: '',
    });
    expect(deleted.version).toMatchObject({
      version: 3,
      changeType: 'delete',
      previousText: 'When I ask to invite Jakub, invite jakub.nowak@gmail.com.',
      itemCount: 0,
    });
  });

  it('generates an item id when callers do not provide one', () => {
    const added = addPromptPreferenceItem(emptyPromptPreferences('user-1'), {
      text: 'When I ask to invite Jakub, invite jakub@gmail.com.',
      now: '2026-06-28T10:00:00.000Z',
      updatedBy: webActor,
    });

    expect(added.current.items[0]?.id).toMatch(/^pref_[a-f0-9]{12}$/u);
    expect(added.version.changedItemId).toBe(added.current.items[0]?.id);
  });

  it('rejects invalid expected versions and overlong rendered prompt blocks', () => {
    const current = emptyPromptPreferences('user-1');

    expect(() => assertExpectedPromptPreferenceVersion(current, -1)).toThrow(
      'expectedVersion must be a non-negative integer'
    );
    expect(() => assertExpectedPromptPreferenceVersion(current, 0.5)).toThrow(
      'expectedVersion must be a non-negative integer'
    );

    expect(() =>
      renderPromptPreferenceBlock(1, [
        {
          id: 'pref_long',
          text: 'a'.repeat(MAX_RENDERED_PROMPT_PREFERENCES_LENGTH),
          createdAt: '2026-06-28T10:00:00.000Z',
          updatedAt: '2026-06-28T10:00:00.000Z',
        },
      ])
    ).toThrow('Rendered preference prompt block must be at most');
  });

  it('rejects adding more than the row limit and unknown update/delete targets', () => {
    const full = emptyPromptPreferences('user-1');
    full.items = Array.from({ length: MAX_PROMPT_PREFERENCE_ITEMS }, (_, index) => ({
      id: `pref_${index}`,
      text: `Preference ${index}`,
      createdAt: '2026-06-28T10:00:00.000Z',
      updatedAt: '2026-06-28T10:00:00.000Z',
    }));
    full.currentVersion = 50;
    full.renderedPromptBlock = renderPromptPreferenceBlock(full.currentVersion, full.items);

    expect(() =>
      addPromptPreferenceItem(full, {
        id: 'pref_overflow',
        text: 'One more preference.',
        now: '2026-06-28T11:00:00.000Z',
        updatedBy: webActor,
      })
    ).toThrow('A maximum of 50 preferences is allowed');

    expect(() =>
      updatePromptPreferenceItem(emptyPromptPreferences('user-1'), {
        itemId: 'pref_missing',
        text: 'Missing',
        now: '2026-06-28T11:00:00.000Z',
        updatedBy: webActor,
      })
    ).toThrow('Preference item not found');

    expect(() =>
      deletePromptPreferenceItem(emptyPromptPreferences('user-1'), {
        itemId: 'pref_missing',
        now: '2026-06-28T11:00:00.000Z',
        updatedBy: webActor,
      })
    ).toThrow('Preference item not found');
  });
});
