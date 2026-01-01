# IntexuraOS Terraform Infrastructure

Terraform configuration for IntexuraOS GCP infrastructure.

## Structure

```
terraform/
├── versions.tf          # Terraform and provider version constraints
├── providers.tf         # Provider configurations
├── variables.tf         # Root-level variable definitions
├── outputs.tf           # Root-level outputs
├── environments/
│   └── dev/             # Development environment
│       ├── backend.tf   # GCS backend configuration
│       ├── main.tf      # Environment-specific resources
│       └── terraform.tfvars.example
└── modules/
    ├── artifact-registry/  # Container image registry
    ├── cloud-build/        # CI/CD pipeline trigger
    ├── cloud-run-service/  # Cloud Run service deployment
    ├── firestore/          # Firestore database
    ├── iam/                # Service accounts and IAM bindings
    └── secret-manager/     # Secret Manager secrets
```

## Quick Start

See [docs/setup/02-terraform-bootstrap.md](../docs/setup/02-terraform-bootstrap.md) for detailed setup instructions.

```bash
cd terraform/environments/dev
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars with your values
terraform init
terraform plan
terraform apply
```

## Modules

| Module              | Purpose                                           |
|---------------------|---------------------------------------------------|
| `artifact-registry` | Docker image registry for Cloud Run services      |
| `cloud-build`       | CI/CD trigger for automatic deployments           |
| `cloud-run-service` | Cloud Run service with Secret Manager integration |
| `firestore`         | Firestore database in Native mode                 |
| `iam`               | Service accounts with least-privilege IAM         |
| `secret-manager`    | Application secrets storage                       |

## Cloud Run Public Access

All Cloud Run services are **public by default** (`allow_unauthenticated = true`).

### Why public access is required

External callers like Meta webhooks (WhatsApp Business API) do not send Google IAM authentication headers.
Services must accept unauthenticated HTTP requests to receive these webhooks.

Each service implements its own authentication:

- **Webhook endpoints**: Validate signatures (e.g., `x-hub-signature-256` for WhatsApp)
- **API endpoints**: Require JWT tokens validated via Auth0 JWKS

### How to opt out per service

To make a specific service private (require IAM authentication):

```hcl
module "my_private_service" {
  source = "../../modules/cloud-run-service"
  # ...other config...

  allow_unauthenticated = false  # Requires IAM authentication
}
```

**Note**: Private services will reject requests without valid Google IAM credentials.

## Environments

Currently only `dev` environment is configured. Production will follow the same pattern.
