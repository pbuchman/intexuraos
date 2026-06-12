import { describe, expect, it } from 'vitest';
import { buildRetentionDecisions, parseArtifactImageRef } from '../artifact-registry/lib.mjs';

describe('artifact registry retention planner', () => {
  it('keeps the newest 3 versions for active packages and preserves protected digests', () => {
    const decisions = buildRetentionDecisions({
      keepCount: 3,
      protectedDigests: ['sha256:older-live'],
      retiredPackages: [],
      versions: [
        {
          createTime: '2026-05-06T21:25:05.027295Z',
          digest: 'sha256:newest',
          imageSizeBytes: 10,
          packageName: 'code-worker',
          tags: ['latest'],
        },
        {
          createTime: '2026-05-05T21:25:05.027295Z',
          digest: 'sha256:newer',
          imageSizeBytes: 10,
          packageName: 'code-worker',
          tags: [],
        },
        {
          createTime: '2026-05-04T21:25:05.027295Z',
          digest: 'sha256:new',
          imageSizeBytes: 10,
          packageName: 'code-worker',
          tags: [],
        },
        {
          createTime: '2026-04-01T21:25:05.027295Z',
          digest: 'sha256:older-live',
          imageSizeBytes: 10,
          packageName: 'code-worker',
          tags: [],
        },
        {
          createTime: '2026-03-01T21:25:05.027295Z',
          digest: 'sha256:delete-me',
          imageSizeBytes: 10,
          packageName: 'code-worker',
          tags: [],
        },
      ],
    });

    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({
      deleteDigests: ['sha256:delete-me'],
      keepDigests: ['sha256:newest', 'sha256:newer', 'sha256:new', 'sha256:older-live'],
      packageName: 'code-worker',
      status: 'active',
    });
  });

  it('marks all versions of retired packages for deletion', () => {
    const decisions = buildRetentionDecisions({
      keepCount: 3,
      protectedDigests: [],
      retiredPackages: ['claude-worker'],
      versions: [
        {
          createTime: '2026-03-26T15:19:35.270271Z',
          digest: 'sha256:dead-a',
          imageSizeBytes: 10,
          packageName: 'claude-worker',
          tags: ['latest'],
        },
        {
          createTime: '2026-03-20T15:19:35.270271Z',
          digest: 'sha256:dead-b',
          imageSizeBytes: 10,
          packageName: 'claude-worker',
          tags: [],
        },
      ],
    });

    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({
      deleteDigests: ['sha256:dead-a', 'sha256:dead-b'],
      keepDigests: [],
      packageName: 'claude-worker',
      status: 'retired',
    });
  });

  it('parses tag and digest image references', () => {
    expect(
      parseArtifactImageRef(
        'europe-central2-docker.pkg.dev/intexuraos-dev-pbuchman/intexuraos-dev/user-service:45ae7a2fe7ef60578d59e25386cfdafa3d1bd8d2'
      )
    ).toMatchObject({
      digest: null,
      image:
        'europe-central2-docker.pkg.dev/intexuraos-dev-pbuchman/intexuraos-dev/user-service:45ae7a2fe7ef60578d59e25386cfdafa3d1bd8d2',
      packageName: 'user-service',
      repository: 'intexuraos-dev',
      tag: '45ae7a2fe7ef60578d59e25386cfdafa3d1bd8d2',
    });

    expect(
      parseArtifactImageRef(
        'europe-central2-docker.pkg.dev/intexuraos-dev-pbuchman/intexuraos-dev/user-service@sha256:732f2a90a076846ffa216f43c013fb5a6e156a22f640481ca2ceb785960edcfd'
      )
    ).toMatchObject({
      digest: 'sha256:732f2a90a076846ffa216f43c013fb5a6e156a22f640481ca2ceb785960edcfd',
      image:
        'europe-central2-docker.pkg.dev/intexuraos-dev-pbuchman/intexuraos-dev/user-service@sha256:732f2a90a076846ffa216f43c013fb5a6e156a22f640481ca2ceb785960edcfd',
      packageName: 'user-service',
      repository: 'intexuraos-dev',
      tag: null,
    });
  });
});
