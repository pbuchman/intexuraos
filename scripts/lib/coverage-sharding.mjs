export function buildCoverageShardCommand(shard, shardCount) {
  return [
    'vitest',
    'run',
    '--reporter=default',
    '--reporter=blob',
    '--coverage',
    '--coverage.thresholds.lines=0',
    '--coverage.thresholds.branches=0',
    '--coverage.thresholds.functions=0',
    '--coverage.thresholds.statements=0',
    `--coverage.reportsDirectory=coverage/shard-${shard}`,
    `--shard=${shard}/${shardCount}`,
  ];
}

export function mergeShardOutputs(outputs) {
  return outputs
    .toSorted((a, b) => a.shard - b.shard)
    .map((entry) => entry.output)
    .join('');
}
