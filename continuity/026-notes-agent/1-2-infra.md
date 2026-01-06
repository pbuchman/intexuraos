# 1-2 Infrastructure Layer

Implement Firestore adapter for note persistence.

## Tasks

- [ ] Create `src/infra/firestore/firestoreNoteRepository.ts`
- [ ] Create `src/infra/firestore/fakeNoteRepository.ts` for testing
- [ ] Register `notes` collection in `firestore-collections.json`
- [ ] Add composite index to migrations: `userId` + `createdAt`
- [ ] Wire repository into `services.ts`
- [ ] Run `npm run verify:firestore`

## Firestore Schema

Collection: `notes/{noteId}`

```
{
  userId: string,
  title: string,
  content: string,
  tags: string[],
  source: string,
  sourceId: string,
  createdAt: Timestamp,
  updatedAt: Timestamp
}
```

## Index

```typescript
// In migrations file
export const indexes = [
  {
    collectionGroup: 'notes',
    fields: [
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'DESCENDING' },
    ],
  },
];
```
