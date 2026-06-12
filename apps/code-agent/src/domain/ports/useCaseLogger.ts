/**
 * Minimal logger port used by domain use cases.
 *
 * Both `pino.Logger` and Fastify's `request.log` structurally satisfy this
 * interface, so route handlers can pass either without casting. Keeping
 * the type in a dedicated port file avoids one use case importing types
 * from another.
 */
export interface UseCaseLogger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}
