# 1-1 Domain Layer

Implement pure business logic with no external dependencies.

## Tasks

- [ ] Create `src/domain/models/note.ts` — Note, CreateNoteInput, UpdateNoteInput
- [ ] Create `src/domain/ports/noteRepository.ts` — repository interface
- [ ] Create `src/domain/usecases/createNote.ts`
- [ ] Create `src/domain/usecases/getNote.ts`
- [ ] Create `src/domain/usecases/listNotes.ts`
- [ ] Create `src/domain/usecases/updateNote.ts`
- [ ] Create `src/domain/usecases/deleteNote.ts`
- [ ] Unit tests for all use cases

## Note Model

```typescript
interface Note {
  id: string;
  userId: string;
  title: string;
  content: string;
  tags: string[];
  source: string;
  sourceId: string;
  createdAt: Date;
  updatedAt: Date;
}
```

## Repository Port

```typescript
interface NoteRepository {
  create(note: Note): Promise<Result<Note, NoteError>>;
  findById(id: string): Promise<Result<Note | null, NoteError>>;
  findByUserId(userId: string): Promise<Result<Note[], NoteError>>;
  update(id: string, input: UpdateNoteInput): Promise<Result<Note, NoteError>>;
  delete(id: string): Promise<Result<void, NoteError>>;
}
```
