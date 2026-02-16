/**
 * Tests for createDevOutputStream - dev-mode formatted log output.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { createDevOutputStream } from '../devStream.js';

describe('createDevOutputStream', () => {
  let output: string[];
  let stream: NodeJS.WritableStream;

  beforeEach(() => {
    output = [];
    stream = createDevOutputStream((line) => {
      output.push(line);
    });
  });

  describe('JSON parsing and formatting', () => {
    it('formats a standard pino log line', () => {
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
      expect(line).toContain('user-service');
      expect(line).toContain('INFO');
      expect(line).toContain('User logged in');
      expect(line).toContain('"userId":"abc"');
      // Excluded fields should NOT be in the extras JSON
      expect(line).not.toContain('"level"');
      expect(line).not.toContain('"pid"');
      expect(line).not.toContain('"hostname"');
    });

    it('formats with pipe separators', () => {
      const log = JSON.stringify({
        level: 30,
        time: Date.now(),
        msg: 'Hello',
        name: 'my-svc',
      });

      stream.write(log);

      const line = output[0] as string;
      // Should have pipe separators between sections
      expect(line).toContain(' | ');
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

  describe('excluded fields removal', () => {
    it('excludes level, time, msg, name, pid, hostname from extras', () => {
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
      expect(line).toContain('"extra":"value"');
      expect(line).not.toContain('"time"');
      expect(line).not.toContain('"name":"svc"');
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
      // Should not have trailing JSON
      expect(line).not.toContain('{');
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
      expect(line).toContain('INFO');
    });

    it('handles missing time gracefully', () => {
      const log = JSON.stringify({ level: 30, name: 'svc', msg: 'hello' });

      stream.write(log);

      const line = output[0] as string;
      expect(line).toContain('svc');
      expect(line).toContain('hello');
    });
  });

  describe('time formatting', () => {
    it('formats time as HH:mm:ss', () => {
      // Use a known timestamp
      const time = new Date('2025-06-15T14:30:45.123Z').getTime();
      stream.write(JSON.stringify({ level: 30, time, msg: 'test', name: 'svc' }));

      const line = output[0] as string;
      // Should contain the time portion (exact value depends on timezone, so just check format)
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
