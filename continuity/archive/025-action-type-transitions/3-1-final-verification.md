# 3-1: Final Verification

## Objective

Ensure all changes pass CI and are ready for commit.

## Tasks

### 1. Run full CI

```bash
npm run ci
```

Must pass:

- Linting
- Type checking
- All tests
- Coverage thresholds
- Firestore ownership verification
- Pub/Sub verification

### 2. Manual testing checklist

- [ ] Create a command via WhatsApp/PWA
- [ ] Open action in InboxPage modal
- [ ] Verify dropdown appears for pending action
- [ ] Change type and verify it persists
- [ ] Verify transition logged in Firestore (`actions_transitions` collection)
- [ ] Approve/execute action and verify correct agent handles it
- [ ] Verify dropdown hidden after action moves to processing

### 3. Verify Firestore indexes

Check if any new indexes needed for `actions_transitions`:

- Query by `userId` + `createdAt` (for listing)

If needed, add to `firestore.indexes.json`.

### 4. Code review checklist

- [ ] No console.log statements
- [ ] No TODO comments left behind
- [ ] All new files have proper imports
- [ ] Services container updated
- [ ] No hardcoded strings (use constants/types)

## Completion

1. Run `npm run ci` — must pass
2. Archive: `mv continuity/025-action-type-transitions continuity/archive/`
3. Commit with message referencing feature

## Notes

After this feature ships, future work includes:

- Using `actions_transitions` data for few-shot learning in classifier
- Action splitting (one command → multiple actions)
