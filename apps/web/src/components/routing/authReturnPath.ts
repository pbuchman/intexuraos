export const AUTH_RETURN_PATH_KEY = 'intexuraos.auth.return-path';

const MAX_RETURN_PATH_LENGTH = 2_048;

export function rememberAuthReturnPath(returnTo: string): void {
  if (!isSafeAuthReturnPath(returnTo)) {
    sessionStorage.removeItem(AUTH_RETURN_PATH_KEY);
    return;
  }
  sessionStorage.setItem(AUTH_RETURN_PATH_KEY, returnTo);
}

export function readAuthReturnPath(): string | null {
  const returnTo = sessionStorage.getItem(AUTH_RETURN_PATH_KEY);
  if (returnTo === null) return null;
  if (isSafeAuthReturnPath(returnTo)) return returnTo;
  sessionStorage.removeItem(AUTH_RETURN_PATH_KEY);
  return null;
}

export function clearAuthReturnPath(): void {
  sessionStorage.removeItem(AUTH_RETURN_PATH_KEY);
}

export function consumeAuthReturnPath(): string | null {
  const returnTo = readAuthReturnPath();
  clearAuthReturnPath();
  return returnTo;
}

function isSafeAuthReturnPath(returnTo: string): boolean {
  if (
    returnTo.length === 0 ||
    returnTo.length > MAX_RETURN_PATH_LENGTH ||
    !returnTo.startsWith('/') ||
    returnTo.startsWith('//') ||
    returnTo.includes('\\') ||
    containsControlCharacter(returnTo)
  ) {
    return false;
  }
  return !/^\/login(?:[?#]|$)/u.test(returnTo);
}

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)) return true;
  }
  return false;
}
