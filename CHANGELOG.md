# Changelog

All notable changes to IntexuraOS will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Initial project structure with hexagonal architecture
- **auth-service**: OAuth2 Device Authorization Flow, ChatGPT Actions OAuth proxy
- **promptvault-service**: Prompt template management with Notion integration
- **whatsapp-service**: WhatsApp Business Cloud API webhook receiver
- **api-docs-hub**: Unified Swagger UI aggregating all service OpenAPI specs
- **@intexuraos/common**: Result types, HTTP utilities, JWT validation
- **@intexuraos/domain-identity**: User identity models and ports
- **@intexuraos/domain-promptvault**: Prompt template domain logic
- **@intexuraos/domain-inbox**: Inbox note and action models
- **@intexuraos/infra-auth0**: Auth0 SDK adapter
- **@intexuraos/infra-notion**: Notion API adapter
- **@intexuraos/infra-firestore**: Firestore adapter with emulator support
- Terraform modules for GCP infrastructure (Cloud Run, Firestore, Secret Manager, IAM)
- Cloud Build CI/CD pipeline with affected-service detection
- Comprehensive setup guides for GCP, Auth0, and WhatsApp integration
- 89%+ test coverage enforcement

### Security

- Refresh tokens encrypted at rest with AES-256-GCM
- Token redaction in all log output
- JWKS-based JWT validation

## [0.0.1] - 2024-12-22

### Added

- Initial sandbox v1 release
- Core architecture and package structure
- Basic authentication flows
- Notion integration foundation

---

[Unreleased]: https://github.com/your-org/praxos/compare/v0.0.1...HEAD
[0.0.1]: https://github.com/your-org/praxos/releases/tag/v0.0.1
