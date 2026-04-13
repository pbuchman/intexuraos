/** Safe localStorage read with JSON parse + validation */
export function loadFromStorage<T>(key: string, validator: (value: unknown) => value is T, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const parsed: unknown = JSON.parse(raw);
    if (validator(parsed)) return parsed;
    return fallback;
  } catch {
    return fallback;
  }
}

/** Safe localStorage write */
export function saveToStorage(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // quota errors are silently ignored
  }
}
