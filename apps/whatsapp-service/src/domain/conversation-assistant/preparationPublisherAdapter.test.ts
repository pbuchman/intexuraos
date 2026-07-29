import { describe, expect, it } from 'vitest';
import { err, ok } from '@intexuraos/common-core';
import { adaptConversationAssistantPreparationPublication } from './preparationPublisherAdapter.js';

describe('adaptConversationAssistantPreparationPublication', () => {
  it('preserves successful publication', () => {
    expect(adaptConversationAssistantPreparationPublication(ok(undefined))).toEqual(
      ok(undefined)
    );
  });

  it('maps publisher failures to the bounded Conversation Assistant contract', () => {
    expect(
      adaptConversationAssistantPreparationPublication(
        err({ code: 'VALIDATION_ERROR', message: 'Queue rejected the event' })
      )
    ).toEqual(
      err({ code: 'INTERNAL_ERROR', message: 'Queue rejected the event' })
    );
  });
});
