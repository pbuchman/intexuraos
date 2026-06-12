export function parseShardArg(value) {
  const match = /^(\d+)\/(\d+)$/.exec(value);
  if (!match) {
    throw new Error(`Invalid shard "${value}". Expected format: index/count`);
  }

  const index = Number.parseInt(match[1], 10);
  const count = Number.parseInt(match[2], 10);

  if (count < 1) {
    throw new Error('Shard count must be at least 1');
  }

  if (index < 1 || index > count) {
    throw new Error(`Shard index must be between 1 and ${count}`);
  }

  return { index, count };
}

export function selectShardItems(items, shard) {
  return items.filter((_, index) => index % shard.count === shard.index - 1);
}
