/**
 * Migration 071: Composite index for optimized research list query
 *
 * Supports single-query pagination with favourites-first ordering:
 *   .where('userId', '==', userId)
 *   .orderBy('favourite', 'desc')
 *   .orderBy('startedAt', 'desc')
 *
 * This replaces the two-query pattern (favourites + non-favourites)
 * with a single query using orderBy('favourite', 'desc').
 */

export const metadata = {
  id: '071',
  name: 'research-list-optimized-index',
  description: 'Composite index for researches optimized list query with favourite DESC ordering',
  createdAt: '2026-03-29',
};

export const indexes = [
  {
    collectionGroup: 'researches',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'favourite', order: 'DESCENDING' },
      { fieldPath: 'startedAt', order: 'DESCENDING' },
    ],
  },
];

export const collections = ['researches'];

export async function up(context) {
  console.log('  Deploying researches optimized list composite index (favourite DESC)...');
  await context.deployIndexes();
}

export async function down() {
  console.log(
    '  Removing researches optimized list index requires manual deletion via Firebase console'
  );
}
