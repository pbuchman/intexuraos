# Environment Variables — Code Patterns

This file contains code examples for the Environment Variables section in CLAUDE.md.

---

## Terraform Patterns

### Common env var (all services)

```hcl
# terraform/environments/dev/main.tf - local.common_service_env_vars
locals {
  common_service_env_vars = {
    INTEXURAOS_NEW_VAR = "value"
  }
}
```

### Service-specific env var

```hcl
# terraform/environments/dev/main.tf - service module
module "my_service" {
  env_vars = merge(local.common_service_env_vars, {
    INTEXURAOS_SERVICE_SPECIFIC_VAR = "value"
  })
}
```

### Secret package membership

Do not create a new Secret Manager container or a per-service Terraform secret
binding for an application value. Add its logical environment name to the
appropriate package contract in `config/environments/secret-packages.json`,
then update its renderer/projection and tests in the same pull request.

```json
{
  "packages": {
    "dev": {
      "envNames": ["INTEXURAOS_MY_SECRET"]
    },
    "prod": {
      "envNames": ["INTEXURAOS_MY_SECRET"]
    }
  }
}
```

The snippet is illustrative; edit the existing complete arrays rather than
replacing the manifest. Package payload values are published outside Terraform
and Git. Terraform owns only the two containers, least-privilege IAM, and the
two documented native transcription exceptions.

---

## ecosystem.config.cjs Patterns

### Common URL

```javascript
// ecosystem.config.cjs - COMMON_SERVICE_URLS
const COMMON_SERVICE_URLS = {
  INTEXURAOS_NEW_SERVICE_URL: 'http://localhost:8XXX',
};
```

### Common secret (from the rendered DEV projection)

```javascript
// ecosystem.config.cjs - COMMON_SERVICE_ENV
const COMMON_SERVICE_ENV = {
  INTEXURAOS_NEW_SECRET: process.env.INTEXURAOS_NEW_SECRET,
};
```

The value is populated by `scripts/sync-secrets.sh` from an exact numeric DEV
package version. `.envrc.local` is for host-only overrides and must not become a
second shared-secret store. Per-service mappings must filter the rendered
environment; never pass the full package to every process.

`SECRET_PACKAGE_GOOGLE_APPLICATION_CREDENTIALS` selects the dedicated renderer
only for package sync. `GOOGLE_APPLICATION_CREDENTIALS` in `.envrc.local`
selects the dedicated home runtime key; the orchestrator generator ignores that
input and fixes its own Artifact Registry reader key. None of these external
bootstrap keys is a package member or worker input.

### Service-specific

```javascript
// ecosystem.config.cjs - SERVICE_ENV_MAPPINGS
const SERVICE_ENV_MAPPINGS = {
  'my-service': {
    INTEXURAOS_MY_SERVICE_TOPIC: 'my-topic',
  },
};
```

---

## Web App Patterns

The web app is a static Vite bundle served by Hetzner nginx, not Cloud Run. Env vars are
baked into the bundle at build time — there is no runtime env surface. Keep the
manifest, generated files, config consumer, and dev proxy in lockstep or the bundle can
throw `Missing required environment variable: <name>` at module-load time.

The Firebase browser API key is the intentional exception to the usual
public-config storage rule: it is supplied from the exact DEV/PROD package to
the build allowlist so it can be rotated and removed from tracked config. It is
still visible to every browser by design. Never pass backend package members to
Vite, and do not treat the browser key as an authorization boundary.

### 1. `apps/web/src/config.ts` — consumer declaration

```typescript
// apps/web/src/config.ts - getConfig()
export function getConfig(): AppConfig {
  return {
    // ...
    // Dev: Vite proxy /api/<path> → local process
    // Prod: absolute Hetzner /api URL baked in from .env at build time
    myServiceUrl: getServiceUrl('INTEXURAOS_MY_SERVICE_URL', '/api/my-service'),
  };
}
```

### 2. `apps/web/service-manifest.json` — generated web URL wiring

```json
{
  "name": "my-service",
  "envSuffix": "MY_SERVICE",
  "apiPath": "/api/my-service",
  "proxyTarget": "http://localhost:8XXX",
  "serviceUrl": "http://localhost:8XXX"
}
```

Run `pnpm run generate:service-wiring` after editing the manifest. The generator updates `apps/web/src/config.generated.ts`, `ecosystem.generated.cjs`, and `terraform/environments/dev/service-urls.auto.tfvars.json`. `scripts/hetzner/deploy-web.sh` renders production URLs from the same manifest with the public Hetzner origin.

### 3. `apps/web/vite.config.ts` + `ecosystem.config.cjs` — dev proxy

```typescript
// apps/web/vite.config.ts - server.proxy
export default defineConfig({
  server: {
    proxy: {
      '/api/my-service': {
        target: 'http://localhost:8XXX',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/my-service/, ''),
      },
    },
  },
});
```

The backing service must also be declared in `ecosystem.config.cjs` so PM2 starts
it on the expected port in dev.
