# Code worker image

The production image and its test counterpart include the tools required by
repository verification. Deployment script fixtures use `rsync` and util-linux
`flock`, including its `--wait` option. Alpine provides the latter in the
standalone `flock` package; BusyBox `flock` does not support that option.

`TMPDIR=/var/tmp` keeps executable test fixtures in the container's writable
temporary directory. The worker's `/tmp` and home directory remain mounted
with `noexec`; `/var/tmp` is not mounted from the host or inside the repository.

Keep these dependencies in both Dockerfiles. Validate dependency changes by
running the affected repository tests as the worker's non-root user with the
production mounts and security options. Worker verification does not require
a Docker executable, a mounted Docker socket, or additional capabilities.
