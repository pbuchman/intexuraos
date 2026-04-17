# INT-1335: Fix misleading deletion_policy in firestore terraform module

> **Evidence document** for planning task INT-1335.
> Generated: 2026-04-10

## Summary

The Firestore Terraform module at `terraform/modules/firestore/main.tf` has a critical comment/value mismatch: the comment says "Prevent accidental deletion" but `deletion_policy = "DELETE"` allows Terraform to destroy the database. This is a data-loss risk, especially since all environments share a single `(default)` database in one GCP project.

## Plan

**Complexity:** SIMPLE (single file, no design decisions)

### Changes to `terraform/modules/firestore/main.tf`

1. Change `deletion_policy = "DELETE"` to `deletion_policy = "ABANDON"` so the database survives removal from state or `terraform destroy`
2. Add `lifecycle { prevent_destroy = true }` as belt-and-braces protection
3. Fix the comment to accurately describe the ABANDON behavior
4. Create a follow-up Linear issue for the PITR enablement decision (out of scope)

### Out of scope

- PITR enablement (separate cost decision)
- Multi-database split (rejected per architecture)
