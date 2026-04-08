export const metadata = {
  id: '084',
  name: 'delete-corrupted-execution-memories',
  description:
    'Delete execution memories with corrupted/zero embedding vectors that return cosineDistance=0 against any query',
  createdAt: '2026-04-08',
};

export async function up(context) {
  const corruptedIds = [
    'mem_1cc9e496-179b-43be-8292-1d43ab140f26',
    'mem_60538ec6-24b7-440c-aaa8-c875ab2bf924',
    'mem_99413905-cde2-4a84-b007-b0dcce3b235a',
    'mem_4ee596d9-5e3b-4c98-879a-32169a8abb12',
    'mem_faf3aaab-287f-4ddb-9219-694e60295870',
  ];

  console.log(`  Deleting ${corruptedIds.length} memories with corrupted embeddings...`);

  const collection = context.firestore.collection('execution_memories');
  let deletedCount = 0;

  for (const id of corruptedIds) {
    const doc = await collection.doc(id).get();
    if (!doc.exists) {
      console.log(`  ${id} — already deleted, skipping`);
      continue;
    }
    const data = doc.data();
    console.log(`  ${id} — "${data.title}" (status: ${data.status}) — deleting`);
    await collection.doc(id).delete();
    deletedCount++;
  }

  console.log(`  Deleted ${deletedCount} corrupted memories.`);
}
