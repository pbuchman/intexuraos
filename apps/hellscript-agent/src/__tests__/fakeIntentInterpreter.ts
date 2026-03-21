import type { IntentInterpreter } from '../domain/ports/intentInterpreter.js';
import type { InterpretedIntent } from '../domain/models/hellscriptEvent.js';
import type { MaterializedBufferState } from '../domain/models/materializedBufferState.js';
import type { Logger } from '@intexuraos/common-core';

export class FakeIntentInterpreter implements IntentInterpreter {
  private nextIntent: InterpretedIntent = {
    kind: 'append_thought',
    payload: { text: 'default thought' },
  };

  private callLog: { utterance: string; state: MaterializedBufferState }[] = [];

  setNextIntent(intent: InterpretedIntent): void {
    this.nextIntent = intent;
  }

  getCalls(): { utterance: string; state: MaterializedBufferState }[] {
    return this.callLog;
  }

  async interpret(
    utterance: string,
    currentState: MaterializedBufferState,
    _logger: Logger
  ): Promise<InterpretedIntent> {
    this.callLog.push({ utterance, state: currentState });
    return this.nextIntent;
  }
}
