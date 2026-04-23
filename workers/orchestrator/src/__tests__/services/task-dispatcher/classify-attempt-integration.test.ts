import { describe, expect, it } from 'vitest';
import { classifyAttempt } from '../../../services/task-dispatcher/classify-attempt.js';

// Real shape of rawLogs as returned by isolation/worker-ops.getWorkerLogs():
// docker logs(timestamps: true) over a claude stream-JSON stdout + attemptLogBuffer
// (same raw JSON). No `[claude]`/`[tool]` prefixes appear here — those are added
// by the in-process claude-log-processor, not by the container.
const realisticRawLogs = [
  '2026-04-23T20:38:46.971Z {"type":"system","subtype":"init","session_id":"abc","tools":[{"name":"Read"}],"model":"claude-sonnet-4-6"}',
  '2026-04-23T20:39:06.934Z {"type":"assistant","message":{"content":[{"type":"text","text":"…"}]}}',
  '2026-04-23T20:40:27.401Z [entrypoint] Claude attempt finished with exit code: 0',
  '',
  // attemptLogBuffer portion (no timestamp) — still raw stream-JSON
  '{"type":"system","subtype":"init","session_id":"abc"}',
].join('\n');

describe('classifyAttempt — realistic production logs', () => {
  it('classifies a successful attempt as ran when logs contain stream-JSON init event', () => {
    expect(classifyAttempt({ logs: realisticRawLogs, exitCode: 0, durationMs: 60_000 })).toEqual({
      outcome: 'ran',
    });
  });
});
