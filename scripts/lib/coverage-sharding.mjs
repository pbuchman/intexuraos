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

const COVERAGE_TMP_FILE_RACE_PATTERN =
  /ENOENT: no such file or directory, (?:open|read) '.*coverage\/shard-\d+\/\.tmp-\d+-\d+\/coverage-\d+\.json'/u;
const COVERAGE_TMP_DIR_LSTAT_RACE_PATTERN =
  /ENOENT: no such file or directory, lstat '.*coverage\/shard-\d+\/\.tmp-\d+-\d+'/u;
const UNHANDLED_COVERAGE_ERROR_PATTERN = /(?:Unhandled Rejection|Unhandled Error)/u;
const TEST_FAILURE_PATTERNS = [/^\s*FAIL\s+/mu, /Test Files\s+.*failed/iu, /Tests\s+.*failed/iu];

function hasRealTestFailure(output) {
  return TEST_FAILURE_PATTERNS.some((pattern) => pattern.test(output));
}

export function isKnownVitestCoverageTmpRace(output) {
  return (
    UNHANDLED_COVERAGE_ERROR_PATTERN.test(output) &&
    (COVERAGE_TMP_FILE_RACE_PATTERN.test(output) ||
      COVERAGE_TMP_DIR_LSTAT_RACE_PATTERN.test(output)) &&
    !hasRealTestFailure(output)
  );
}

export function isKnownVitestCoverageTmpDirCleanupRace(output) {
  return (
    UNHANDLED_COVERAGE_ERROR_PATTERN.test(output) &&
    COVERAGE_TMP_DIR_LSTAT_RACE_PATTERN.test(output) &&
    !hasRealTestFailure(output)
  );
}

export function shouldRetryCoverageShard(result) {
  return (
    result.code !== 0 &&
    isKnownVitestCoverageTmpRace(result.output) &&
    !isKnownVitestCoverageTmpDirCleanupRace(result.output)
  );
}

export function shouldIgnoreCoverageShardFailure(result) {
  return result.code !== 0 && isKnownVitestCoverageTmpDirCleanupRace(result.output);
}

export function shouldRetryCoverageMerge(result) {
  return result.code !== 0 && isKnownVitestCoverageTmpRace(result.output);
}
