/**
 * Migration 126: Matrix corpus control-plane recovery indexes.
 *
 * Each index is required by one bounded recovery query in whatsapp-service:
 * pending ingest/terminal records ordered by creation, expired claimed records
 * ordered by claim expiry, and expired nonterminal leases ordered by expiry.
 */

export const metadata = {
  id: '126',
  name: 'matrix-corpus-control-plane-indexes',
  description: 'Indexes for bounded Matrix corpus outbox and expired-lease recovery',
  createdAt: '2026-07-20',
};

export const collections = [
  'matrix_corpus_ingest_outbox',
  'matrix_corpus_terminal_control_outbox',
  'matrix_corpus_run_leases',
];

export const indexes = [
  {
    collectionGroup: 'matrix_corpus_ingest_outbox',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'ASCENDING' },
    ],
  },
  {
    collectionGroup: 'matrix_corpus_ingest_outbox',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'claim.expiresAt', order: 'ASCENDING' },
    ],
  },
  {
    collectionGroup: 'matrix_corpus_terminal_control_outbox',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'ASCENDING' },
    ],
  },
  {
    collectionGroup: 'matrix_corpus_terminal_control_outbox',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'claim.expiresAt', order: 'ASCENDING' },
    ],
  },
  {
    collectionGroup: 'matrix_corpus_run_leases',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'phase', order: 'ASCENDING' },
      { fieldPath: 'expiresAt', order: 'ASCENDING' },
    ],
  },
];

export async function up(context) {
  console.log('  Deploying Matrix corpus control-plane recovery indexes...');
  await context.deployIndexes();
}
