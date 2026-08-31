export function buildLocalEmulatorStartPlan() {
  return [
    ['up', '-d', '--wait', 'pubsub-emulator'],
    ['build', 'pubsub-ui'],
    ['run', '--rm', '--no-deps', 'pubsub-ui', 'node', 'bootstrap.mjs'],
    ['up', '-d', '--no-build', 'pubsub-ui'],
  ];
}
