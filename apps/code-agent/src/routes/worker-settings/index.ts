/**
 * Worker settings routes aggregator.
 *
 * Exposes the three resource-specific sub-plugins used by
 * `workerSettingsRoutes`:
 * - `settingCrudRoutes` — CRUD on worker configurations
 * - `workerOpsRoutes` — per-worker operations (connectivity test, reorder)
 * - `configRoutes` — per-category default-worker-type settings
 */

export { settingCrudRoutes } from './setting-crud-routes.js';
export type { SettingCrudRoutesOptions } from './setting-crud-routes.js';
export { workerOpsRoutes } from './worker-ops-routes.js';
export type { WorkerOpsRoutesOptions } from './worker-ops-routes.js';
export { configRoutes } from './config-routes.js';
export type { ConfigRoutesOptions } from './config-routes.js';
