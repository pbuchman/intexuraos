# PraxOS

Notion models the world. PraxOS executes.

## Documentation

- [Architecture & Philosophy](./docs/README.md)
- [Package Contracts](./docs/architecture/package-contracts.md)
- [API Contracts](./docs/architecture/api-contracts.md)
- [Branding](./docs/assets/branding/README.md)

## API Documentation

Access aggregated API documentation for all PraxOS services via the API Docs Hub:

- **Production**: Available at the `api_docs_hub_url` Terraform output
- **Local Development**: Run `api-docs-hub` locally with required environment variables

The API Docs Hub provides a unified Swagger UI interface with a dropdown to select between:

- Auth Service API
- Notion GPT Service API

Each service also exposes its own documentation at `/docs` and `/openapi.json`.

For details on the runtime OpenAPI aggregation architecture, see [API Contracts](./docs/architecture/api-contracts.md#runtime-openapi-aggregation).

## Setup Guides

1. [GCP Project Setup](./docs/setup/01-gcp-project.md)
2. [Terraform Bootstrap](./docs/setup/02-terraform-bootstrap.md)
3. [Cloud Build Trigger](./docs/setup/03-cloud-build-trigger.md)
4. [Cloud Run Services](./docs/setup/04-cloud-run-services.md)
5. [Local Development](./docs/setup/05-local-dev-with-gcp-deps.md)
6. [Auth0 Setup](./docs/setup/06-auth0.md)
7. [WhatsApp Business Cloud API](./docs/setup/07-whatsapp-business-cloud-api.md)

## Infrastructure

- [Terraform](./terraform/README.md)

## Quick Start

```bash
npm install
npm run ci
```
