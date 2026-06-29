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
    '--pool=threads',
    `--shard=${shard}/${shardCount}`,
  ];
}

export function coverageShardTmpDirectory(shard, shardCount) {
  return `coverage/shard-${shard}/.tmp-${shard}-${shardCount}`;
}

export function mergeShardOutputs(outputs) {
  return outputs
    .toSorted((a, b) => a.shard - b.shard)
    .map((entry) => entry.output)
    .join('');
}

export function isKnownVitestCoverageTmpRace(output) {
  return (
    /(?:Unhandled Rejection|Unhandled Error)/u.test(output) &&
    /ENOENT: no such file or directory, (?:open|read) '.*coverage\/shard-\d+\/\.tmp-\d+-\d+\/coverage-\d+\.json'/u.test(
      output
    ) &&
    !/^\s*FAIL\s+/mu.test(output) &&
    !/Test Files\s+.*failed/iu.test(output) &&
    !/Tests\s+.*failed/iu.test(output)
  );
}

export function shouldRetryCoverageShard(result) {
  return result.code !== 0 && isKnownVitestCoverageTmpRace(result.output);
}
