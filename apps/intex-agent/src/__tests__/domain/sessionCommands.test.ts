import { describe, expect, it } from 'vitest';
import { detectSessionCommand } from '../../domain/messages/sessionCommands.js';

describe('detectSessionCommand', () => {
  it.each(['/new', 'new session', 'start new session', 'start over', 'forget this and start over'])(
    'recognizes %s as an explicit new-session command',
    (text) => {
      expect(detectSessionCommand(text)).toEqual({
        kind: 'start_new',
        requestText: null,
      });
    }
  );

  it('extracts the first request text from a new-session command with a colon', () => {
    expect(detectSessionCommand('new session: remember the garage code is 7241')).toEqual({
      kind: 'start_new',
      requestText: 'remember the garage code is 7241',
    });
  });

  it('treats an empty new-session command suffix as an idle new session', () => {
    expect(detectSessionCommand('new session:   ')).toEqual({
      kind: 'start_new',
      requestText: null,
    });
  });

  it('is case-insensitive and trims surrounding whitespace', () => {
    expect(detectSessionCommand('  Start New Session: Add dentist Friday at 2 PM  ')).toEqual({
      kind: 'start_new',
      requestText: 'Add dentist Friday at 2 PM',
    });
  });

  it('does not treat ordinary note content as a session command', () => {
    expect(detectSessionCommand('Remember the new session agenda for Thursday')).toEqual({
      kind: 'none',
    });
  });

  it('does not treat a partial phrase as a session command', () => {
    expect(detectSessionCommand('new session notes should include the launch checklist')).toEqual({
      kind: 'none',
    });
  });
});
