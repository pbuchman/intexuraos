export interface Note {
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

export interface CreateNoteInput {
  userId: string;
  title: string;
  content: string;
  tags: string[];
  source: string;
  sourceId: string;
}

export interface UpdateNoteInput {
  title?: string;
  content?: string;
  tags?: string[];
}
