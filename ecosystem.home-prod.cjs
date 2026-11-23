// The code-agent signer is supervised by its dedicated systemd service on port 18128.
const production = require('./ecosystem.config.prod.cjs');

module.exports = {
  apps: production.apps.filter((app) => app.name !== 'code-agent'),
};
