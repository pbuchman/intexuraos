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

### Secret (from Secret Manager)

```hcl
# terraform/environments/dev/main.tf - service module
module "my_service" {
  secrets = merge(local.common_service_secrets, {
    INTEXURAOS_MY_SECRET = module.secret_manager.secret_ids["INTEXURAOS_MY_SECRET"]
  })
}
```

---

## ecosystem.config.cjs Patterns

### Common URL

```javascript
// ecosystem.config.cjs - COMMON_SERVICE_URLS
const COMMON_SERVICE_URLS = {
  INTEXURAOS_NEW_SERVICE_URL: 'http://localhost:8XXX',
};
```

### Common secret (from .envrc.local)

```javascript
// ecosystem.config.cjs - COMMON_SERVICE_ENV
const COMMON_SERVICE_ENV = {
  INTEXURAOS_NEW_SECRET: process.env.INTEXURAOS_NEW_SECRET,
};
```

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
