/**
 * Default `NODE_ENV=development` when the host hasn't set it.
 *
 * The orchestrator only runs on dev hosts (home-dev VM, dev macOS) — never
 * on Cloud Run — so a hard default is safe. This mirrors the inline
 * `NODE_ENV=development` in the `pnpm dev` script (orchestrator
 * package.json) but covers launchers that bypass pnpm: the home-dev
 * systemd unit (`ExecStart=node dist/index.js`) and the macOS
 * LaunchAgent. PM2-managed apps already pass NODE_ENV via
 * `ecosystem.config.cjs`; the orchestrator is not under PM2.
 *
 * Without this default, `createAppLogger()` (packages/infra-sentry) takes
 * the JSON-stdout branch (`isDev = NODE_ENV === 'development'` is false)
 * and journalctl shows raw JSON instead of the pino-pretty stream.
 *
 * Must be invoked before `initWorker()` so the gating decision picks up
 * the defaulted value.
 */
export function defaultNodeEnv(): void {
  process.env['NODE_ENV'] ??= 'development';
}
