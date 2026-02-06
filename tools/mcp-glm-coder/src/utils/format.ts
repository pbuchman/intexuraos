export function formatDuration(milliseconds: number): string {
  if (milliseconds < 1000) {
    return String(milliseconds) + 'ms';
  }

  if (milliseconds < 60000) {
    const seconds = milliseconds / 1000;
    return String(seconds) + 's';
  }

  const minutes = Math.floor(milliseconds / 60000);
  const seconds = Math.floor((milliseconds % 60000) / 1000);
  return String(minutes) + 'm ' + String(seconds) + 's';
}
