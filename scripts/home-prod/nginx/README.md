# Home PROD nginx integration boundary

Tracked nginx templates for Home PROD belong in this directory. The native deployment
and host bootstrap reserve the following external paths but do not create or activate edge
configuration:

- `/etc/systemd/system/intexuraos-home-prod-nginx.service`
- `/etc/caddy/Caddyfile.d/intexuraos-home-prod.caddy`

The nginx unit must run as `intexuraos-prod`, use only loopback listeners, and read the
mode-`0600` internal-auth token from the dedicated user's projection. It must not change
the shared Caddy, Cloudflare tunnel, or Alloy ownership boundary.
