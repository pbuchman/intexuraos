# INT-1458 Investigation Evidence

**Task:** Fix audio upload failures in dev environment

**Date:** 2026-04-23

## Summary

Investigation completed. Root cause identified as bucket name mismatch.

## Root Cause

The Terraform module creates a bucket named `intexuraos-whatsapp-media-${var.environment}`.
For dev environment, this creates: `intexuraos-whatsapp-media-dev`.

The home-dev PM2 configuration (`ecosystem.config.cjs`) and local dev example (`\.envrc.local.example`) have incorrect fallback bucket names that don't match the Terraform-created bucket.

## Evidence Files Analyzed

- `terraform/modules/whatsapp-media-bucket/main.tf` (line 6) — bucket naming
- `ecosystem.config.cjs` (line 95) — wrong fallback `'whatsapp-media'`
- `.envrc.local.example` (line 57) — wrong export `intexuraos-whatsapp-media`

## Fix Required

Two simple file edits:
1. `ecosystem.config.cjs`: change fallback to `'intexuraos-whatsapp-media-dev'`
2. `.envrc.local.example`: change export to `intexuraos-whatsapp-media-dev`