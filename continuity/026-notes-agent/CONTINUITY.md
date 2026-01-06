# Continuity Ledger — 026 Notes Agent

## Goal

Create `notes-agent` with user-authenticated CRUD and internal POST endpoint.

## Success Criteria

- `npm run ci` passes
- `terraform validate` passes
- All endpoints functional with tests
- Registered in api-docs-hub
- Added to local dev setup

---

## Status

### Done

- [x] Domain model design confirmed

### Now

- [ ] 1-0: Scaffold service structure

### Next

- [ ] 1-1: Domain layer (models, ports, use cases)
- [ ] 1-2: Infrastructure layer (Firestore adapter)
- [ ] 1-3: Routes (user-authenticated endpoints)
- [ ] 1-4: Routes (internal endpoint)
- [ ] 1-5: Terraform & deployment config
- [ ] 2-0: Integration & verification

---

## Key Decisions

| Decision                        | Reasoning                                          |
| ------------------------------- | -------------------------------------------------- |
| Simple string tags              | No need for Tag entity complexity at this stage    |
| `source` + `sourceId` immutable | Preserves origin traceability                      |
| Single internal POST            | Only creation needed from other services initially |

---

## Open Questions

None currently.
