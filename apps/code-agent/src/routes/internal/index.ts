/**
 * Internal routes index.
 * Exports all internal code-agent routes.
 */

import processRoute from './process.js';
import taskUpdateRoute from './taskUpdate.js';
import linearActiveRoute from './linearActive.js';
import zombiesRoute from './zombies.js';
import maintenanceRoute from './maintenance.js';
import cancelWithNonceRoute from './cancelWithNonce.js';

export {
  processRoute,
  taskUpdateRoute,
  linearActiveRoute,
  zombiesRoute,
  maintenanceRoute,
  cancelWithNonceRoute,
};
