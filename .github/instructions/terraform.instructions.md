---
applyTo: 'terraform/**'
---

# Terraform Instructions

**Verification:**

```bash
terraform fmt -check -recursive   # From /terraform
terraform validate                # From /terraform or environment dir
```

---

## Repo-specific gotchas

### Web hosting (GCS backend bucket)

When changing `terraform/modules/web-app`:

- Remember that backend buckets **do not** honor GCS `website.main_page_suffix`.
- `GET /` will 404 unless the URL map rewrites `/` → `/index.html`.

Reference: `docs/architecture/web-app-hosting.md`

---

## Rules

| Rule                              | Verification                      |
| --------------------------------- | --------------------------------- |
| Formatted                         | `terraform fmt -check -recursive` |
| Valid syntax                      | `terraform validate`              |
| No hardcoded secrets              | Manual review                     |
| Variables have description + type | `terraform validate`              |
| Outputs have description          | `terraform validate`              |

---

## Structure

```
terraform/
├── environments/dev/   # Environment config
├── modules/            # Reusable modules
├── variables.tf        # Input variables
└── outputs.tf          # Outputs
```

---

## Change Process

1. `terraform fmt -recursive`
2. `terraform validate`
3. `terraform plan` (review before apply)
4. Document in commit message

---

## Checklist

- [ ] `terraform fmt -check -recursive` passes
- [ ] `terraform validate` passes
- [ ] No hardcoded secrets/regions/project IDs
- [ ] Plan reviewed (if environment access available)
