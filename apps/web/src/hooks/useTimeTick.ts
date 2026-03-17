import { useEffect, useState } from 'react';

export function useTimeTick(intervalMs: number, enabled?: boolean): number {
  const [tick, setTick] = useState(0);
  const isEnabled = enabled !== false;

  useEffect(() => {
    if (!isEnabled) return;
    const id = setInterval(() => { setTick((prev) => prev + 1); }, intervalMs);
    return (): void => { clearInterval(id); };
  }, [intervalMs, isEnabled]);

  return tick;
}
