/**
 * Manual mock for virtual:pwa-register Vite plugin module.
 */

export function registerSW() {
  return async function updateSW(_reloadPage?: boolean): Promise<void> {
    // Mock implementation - no-op in tests
  };
}
