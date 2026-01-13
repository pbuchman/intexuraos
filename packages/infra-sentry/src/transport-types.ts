/**
 * Type definitions for Pino transport compatibility.
 *
 * Pino's transport expects a specific shape. This file defines
 * the interface to avoid type conflicts with Pino's internal types.
 */

/**
 * Shape of a Pino log event.
 */
export interface LogEvent {
  msg?: string;
  err?: unknown;
  level: number;
  time: number;
  [key: string]: unknown;
}

/**
 * Transport destination that Pino can process.
 * Compatible with Fastify's logger.transport option.
 */
export interface TransportDestination {
  level: string;
  send(level: string, logEvent: LogEvent): void;
}
