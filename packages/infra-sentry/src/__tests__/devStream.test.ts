/**
 * Tests for createDevOutputStream - dev-mode formatted log output.
 *
 * Output format: HH:mm:ss | LEVEL | service-name | message | key=val key=val
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { createDevOutputStream } from '../devStream.js';

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[\d+m/g;
const stripAnsi = (s: string): string => s.replace(ANSI_RE, '');

describe('createDevOutputStream', () => {
  let output: string[];
  let stream: NodeJS.WritableStream;

  beforeEach(() => {
    output = [];
    stream = createDevOutputStream((line) => {
      output.push(line);
    });
  });

  describe('column ordering', () => {
    it('formats as time | level | name | message | extras', () => {
      const log = JSON.stringify({
        level: 30,
        time: new Date('2025-01-15T17:30:02.000Z').getTime(),
        msg: 'User logged in',
        name: 'user-service',
        pid: 1234,
        hostname: 'dev-machine',
        userId: 'abc',
      });

      stream.write(log);

      expect(output).toHaveLength(1);
      const line = output[0] as string;

      // Strip ANSI codes for order checking
      const stripped = stripAnsi(line);
      const segments = stripped.split(' | ');

      // time | LEVEL | name | message | extras
      expect(segments).toHaveLength(5);
      expect(segments[0]).toMatch(/\d{2}:\d{2}:\d{2}/);
      expect(segments[1]).toContain('INFO');
      expect(segments[2]).toBe('user-service');
      expect(segments[3]).toBe('User logged in');
      expect(segments[4]).toContain('userId=abc');
    });

    it('uses pipe separators', () => {
      const log = JSON.stringify({
        level: 30,
        time: Date.now(),
        msg: 'Hello',
        name: 'my-svc',
      });

      stream.write(log);

      const line = output[0] as string;
      expect(line).toContain(' | ');
    });
  });

  describe('extras as key=val', () => {
    it('formats extras as key=value pairs instead of JSON', () => {
      const log = JSON.stringify({
        level: 30,
        time: Date.now(),
        msg: 'test',
        name: 'svc',
        taskId: 'abc123',
        status: 'completed',
      });

      stream.write(log);

      const line = output[0] as string;
      expect(line).toContain('taskId=abc123');
      expect(line).toContain('status=completed');
      // Should NOT have JSON braces
      expect(line).not.toMatch(/"taskId"/);
    });

    it('excludes reqId from extras (noise)', () => {
      const log = JSON.stringify({
        level: 30,
        time: Date.now(),
        msg: 'request completed',
        name: 'svc',
        reqId: 'req-6',
        extra: 'kept',
      });

      stream.write(log);

      const line = output[0] as string;
      expect(line).not.toContain('reqId');
      expect(line).toContain('extra=kept');
    });

    it('keeps reqId on warning and error lines that are reported to Sentry', () => {
      for (const level of [40, 50, 60]) {
        stream.write(
          JSON.stringify({
            level,
            time: Date.now(),
            msg: 'reported failure',
            name: 'svc',
            reqId: 'req-6',
          })
        );
      }

      expect(output).toHaveLength(3);
      for (const line of output) {
        expect(stripAnsi(line)).toContain('reqId=req-6');
      }
    });

    it('excludes standard pino fields from extras', () => {
      const log = JSON.stringify({
        level: 30,
        time: Date.now(),
        msg: 'test',
        name: 'svc',
        pid: 9999,
        hostname: 'host',
        extra: 'value',
      });

      stream.write(log);

      const line = output[0] as string;
      expect(line).toContain('extra=value');
      expect(line).not.toContain('pid');
      expect(line).not.toContain('hostname');
    });

    it('omits extras section when no extra fields remain', () => {
      const log = JSON.stringify({
        level: 30,
        time: Date.now(),
        msg: 'bare message',
        name: 'svc',
      });

      stream.write(log);

      const line = output[0] as string;
      // Strip ANSI and check segment count
      const stripped = stripAnsi(line);
      const segments = stripped.split(' | ');
      expect(segments).toHaveLength(4); // time | level | name | message (no extras)
    });
  });

  describe('Fastify req/res special handling', () => {
    it('inlines res.statusCode as bare number', () => {
      const log = JSON.stringify({
        level: 30,
        time: Date.now(),
        msg: 'request completed',
        name: 'svc',
        res: { statusCode: 200 },
        responseTime: 150.458,
      });

      stream.write(log);

      const line = output[0] as string;
      expect(line).toContain('200');
      expect(line).not.toContain('statusCode');
    });

    it('inlines responseTime as rounded ms', () => {
      const log = JSON.stringify({
        level: 30,
        time: Date.now(),
        msg: 'request completed',
        name: 'svc',
        responseTime: 150.458,
      });

      stream.write(log);

      const line = output[0] as string;
      expect(line).toContain('150ms');
      expect(line).not.toContain('responseTime');
    });

    it('inlines req as METHOD /path', () => {
      const log = JSON.stringify({
        level: 30,
        time: Date.now(),
        msg: 'incoming request',
        name: 'svc',
        req: { method: 'POST', url: '/auth/firebase-token', host: 'dev.intexuraos.cloud' },
      });

      stream.write(log);

      const line = output[0] as string;
      expect(line).toContain('POST /auth/firebase-token');
      expect(line).not.toContain('host');
    });

    it('ignores req object without method/url', () => {
      const log = JSON.stringify({
        level: 30,
        time: Date.now(),
        msg: 'test',
        name: 'svc',
        req: { something: 'else' },
      });

      stream.write(log);

      const line = output[0] as string;
      // req without method/url should not produce METHOD /path output
      expect(line).not.toContain('something');
      expect(line).not.toContain('/');
    });

    it('combines res + responseTime + extras cleanly', () => {
      const log = JSON.stringify({
        level: 30,
        time: Date.now(),
        msg: 'request completed',
        name: 'svc',
        reqId: 'req-3',
        res: { statusCode: 200 },
        responseTime: 86.729,
      });

      stream.write(log);

      const stripped = stripAnsi(output[0] as string);
      // Should have: 200 87ms (no reqId, no JSON objects)
      expect(stripped).toContain('200 87ms');
      expect(stripped).not.toContain('reqId');
    });
  });

  describe('value truncation', () => {
    it('truncates strings longer than 32 chars', () => {
      const longId = 'task_5d3fad2b-707d-4f4c-85c8-6b749a1af7ce';
      const log = JSON.stringify({
        level: 30,
        time: Date.now(),
        msg: 'test',
        name: 'svc',
        taskId: longId,
      });

      stream.write(log);

      const line = output[0] as string;
      expect(line).toContain('taskId=task_5d3…f7ce');
      expect(line).not.toContain(longId);
    });

    it.each([
      'requestId',
      'request_id',
      'reqId',
      'req_id',
      'taskId',
      'task_id',
      'traceId',
      'trace_id',
    ])('keeps the full warning-level %s correlation value for exact log lookup', (key) => {
      const correlationId = '12345678-1234-4123-8123-123456789abc';
      stream.write(
        JSON.stringify({
          level: 40,
          time: Date.now(),
          msg: 'reported warning',
          name: 'svc',
          [key]: correlationId,
        })
      );

      expect(stripAnsi(output.at(-1) as string)).toContain(`${key}=${correlationId}`);
    });

    it('keeps short strings intact', () => {
      const log = JSON.stringify({
        level: 30,
        time: Date.now(),
        msg: 'test',
        name: 'svc',
        status: 'completed',
      });

      stream.write(log);

      const line = output[0] as string;
      expect(line).toContain('status=completed');
    });

    it('formats booleans as-is', () => {
      const log = JSON.stringify({
        level: 30,
        time: Date.now(),
        msg: 'test',
        name: 'svc',
        hasResult: false,
        hasLinearIssue: true,
      });

      stream.write(log);

      const line = output[0] as string;
      expect(line).toContain('hasResult=false');
      expect(line).toContain('hasLinearIssue=true');
    });

    it('formats empty arrays as []', () => {
      const log = JSON.stringify({
        level: 30,
        time: Date.now(),
        msg: 'test',
        name: 'svc',
        resultKeys: [],
      });

      stream.write(log);

      const line = output[0] as string;
      expect(line).toContain('resultKeys=[]');
    });

    it('formats short arrays inline', () => {
      const log = JSON.stringify({
        level: 30,
        time: Date.now(),
        msg: 'test',
        name: 'svc',
        tags: ['a', 'b'],
      });

      stream.write(log);

      const line = output[0] as string;
      expect(line).toContain('tags=["a","b"]');
    });

    it('summarizes long arrays', () => {
      const log = JSON.stringify({
        level: 30,
        time: Date.now(),
        msg: 'test',
        name: 'svc',
        items: ['aaa', 'bbb', 'ccc', 'ddd', 'eee', 'fff', 'ggg'],
      });

      stream.write(log);

      const line = output[0] as string;
      expect(line).toContain('items=[7 items]');
    });

    it('formats null values', () => {
      const log = JSON.stringify({
        level: 30,
        time: Date.now(),
        msg: 'test',
        name: 'svc',
        result: null,
      });

      stream.write(log);

      const line = output[0] as string;
      expect(line).toContain('result=null');
    });

    it('truncates long nested objects', () => {
      const log = JSON.stringify({
        level: 30,
        time: Date.now(),
        msg: 'test',
        name: 'svc',
        error: { message: 'Something went very wrong with the connection to the database server' },
      });

      stream.write(log);

      const stripped = stripAnsi(output[0] as string);
      // Should be truncated (the JSON is > 32 chars)
      expect(stripped).toContain('error=');
      expect(stripped).toContain('…');
    });

    it('keeps short nested objects as JSON', () => {
      const log = JSON.stringify({
        level: 30,
        time: Date.now(),
        msg: 'test',
        name: 'svc',
        data: { ok: true },
      });

      stream.write(log);

      const line = output[0] as string;
      expect(line).toContain('data={"ok":true}');
    });
  });

  describe('level color mapping', () => {
    it('maps TRACE level (10)', () => {
      stream.write(JSON.stringify({ level: 10, time: Date.now(), msg: 'trace msg', name: 'svc' }));
      const line = output[0] as string;
      expect(line).toContain('TRACE');
    });

    it('maps DEBUG level (20)', () => {
      stream.write(JSON.stringify({ level: 20, time: Date.now(), msg: 'debug msg', name: 'svc' }));
      const line = output[0] as string;
      expect(line).toContain('DEBUG');
    });

    it('maps INFO level (30)', () => {
      stream.write(JSON.stringify({ level: 30, time: Date.now(), msg: 'info msg', name: 'svc' }));
      const line = output[0] as string;
      expect(line).toContain('INFO');
    });

    it('maps WARN level (40)', () => {
      stream.write(JSON.stringify({ level: 40, time: Date.now(), msg: 'warn msg', name: 'svc' }));
      const line = output[0] as string;
      expect(line).toContain('WARN');
    });

    it('maps ERROR level (50)', () => {
      stream.write(JSON.stringify({ level: 50, time: Date.now(), msg: 'error msg', name: 'svc' }));
      const line = output[0] as string;
      expect(line).toContain('ERROR');
    });

    it('maps FATAL level (60)', () => {
      stream.write(JSON.stringify({ level: 60, time: Date.now(), msg: 'fatal msg', name: 'svc' }));
      const line = output[0] as string;
      expect(line).toContain('FATAL');
    });

    it('handles unknown level numbers', () => {
      stream.write(JSON.stringify({ level: 99, time: Date.now(), msg: 'unknown', name: 'svc' }));
      const line = output[0] as string;
      expect(line).toContain('LVL99');
    });
  });

  describe('non-JSON passthrough', () => {
    it('passes through non-JSON lines as-is', () => {
      stream.write('plain text log line');

      expect(output).toHaveLength(1);
      expect(output[0]).toBe('plain text log line');
    });

    it('passes through empty lines', () => {
      stream.write('');

      expect(output).toHaveLength(1);
      expect(output[0]).toBe('');
    });
  });

  describe('missing fields', () => {
    it('handles missing level gracefully (defaults to INFO)', () => {
      const log = JSON.stringify({ time: Date.now(), name: 'svc', msg: 'no level' });

      stream.write(log);

      const line = output[0] as string;
      expect(line).toContain('INFO');
      expect(line).toContain('no level');
    });

    it('handles missing msg gracefully', () => {
      const log = JSON.stringify({ level: 30, time: Date.now(), name: 'svc' });

      stream.write(log);

      const line = output[0] as string;
      expect(line).toContain('svc');
      expect(line).toContain('INFO');
    });

    it('handles missing name gracefully', () => {
      const log = JSON.stringify({ level: 30, time: Date.now(), msg: 'hello' });

      stream.write(log);

      const line = output[0] as string;
      expect(line).toContain('hello');
      expect(line).toContain('???');
    });

    it('handles missing time gracefully', () => {
      const log = JSON.stringify({ level: 30, name: 'svc', msg: 'hello' });

      stream.write(log);

      const line = output[0] as string;
      expect(line).toContain('--:--:--');
      expect(line).toContain('hello');
    });
  });

  describe('time formatting', () => {
    it('formats time as HH:mm:ss', () => {
      const time = new Date('2025-06-15T14:30:45.123Z').getTime();
      stream.write(JSON.stringify({ level: 30, time, msg: 'test', name: 'svc' }));

      const line = output[0] as string;
      expect(line).toMatch(/\d{2}:\d{2}:\d{2}/);
    });
  });

  describe('multiline handling', () => {
    it('handles input with trailing newline', () => {
      stream.write(
        JSON.stringify({ level: 30, time: Date.now(), msg: 'test', name: 'svc' }) + '\n'
      );

      expect(output).toHaveLength(1);
      const line = output[0] as string;
      expect(line).toContain('test');
    });
  });
});

describe('createDevOutputStream with default writer', () => {
  let originalStdoutWrite: typeof process.stdout.write;
  let written: string[];

  beforeEach(() => {
    written = [];
    originalStdoutWrite = process.stdout.write;
    process.stdout.write = vi.fn((...args: unknown[]) => {
      written.push(String(args[0]));
      return true;
    }) as typeof process.stdout.write;
  });

  afterEach(() => {
    process.stdout.write = originalStdoutWrite;
  });

  it('writes to stdout by default', () => {
    const stream = createDevOutputStream();
    stream.write(
      JSON.stringify({ level: 30, time: Date.now(), msg: 'default output', name: 'svc' })
    );

    expect(written.length).toBeGreaterThan(0);
    expect(written.some((w) => w.includes('default output'))).toBe(true);
  });
});
