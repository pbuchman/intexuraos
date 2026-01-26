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

## dev.mjs Patterns

### Common URL

```javascript
// scripts/dev.mjs - COMMON_SERVICE_URLS
const COMMON_SERVICE_URLS = {
  INTEXURAOS_NEW_SERVICE_URL: 'http://localhost:8XXX',
};
```

### Common secret (from .envrc.local)

```javascript
// scripts/dev.mjs - COMMON_SERVICE_ENV
const COMMON_SERVICE_ENV = {
  INTEXURAOS_NEW_SECRET: process.env.INTEXURAOS_NEW_SECRET,
};
```

### Service-specific

```javascript
// scripts/dev.mjs - SERVICE_ENV_MAPPINGS
const SERVICE_ENV_MAPPINGS = {
  'my-service': {
    INTEXURAOS_MY_SERVICE_TOPIC: 'my-topic',
  },
};
```
