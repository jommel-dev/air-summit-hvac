export const ACCESS_TOKEN_KEY = 'accessToken';
export const REFRESH_TOKEN_KEY = 'refreshToken';
export const SESSION_PERSIST_KEY = 'sessionPersist';
export const EFFECTIVE_PERMISSION_KEYS = 'effectivePermissionKeys';
export const DENIED_PERMISSION_KEYS = 'deniedPermissionKeys';

function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

/**
 * sessionStorage is tab-scoped, so a logged-in tab would not share the
 * session with a new tab on "/". Always keep auth tokens in localStorage.
 */
function migrateAuthKeysFromSessionStorage(): void {
  const keys = [
    ACCESS_TOKEN_KEY,
    REFRESH_TOKEN_KEY,
    EFFECTIVE_PERMISSION_KEYS,
    DENIED_PERMISSION_KEYS,
  ];

  let migrated = false;

  for (const key of keys) {
    if (localStorage.getItem(key)) {
      sessionStorage.removeItem(key);
      continue;
    }

    const fromSession = sessionStorage.getItem(key);
    if (fromSession) {
      localStorage.setItem(key, fromSession);
      sessionStorage.removeItem(key);
      migrated = true;
    }
  }

  if (migrated || localStorage.getItem(ACCESS_TOKEN_KEY)) {
    localStorage.setItem(SESSION_PERSIST_KEY, '1');
  }
}

export function getAccessToken(): string | null {
  if (!isBrowser()) {
    return null;
  }

  migrateAuthKeysFromSessionStorage();
  return localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  if (!isBrowser()) {
    return null;
  }

  migrateAuthKeysFromSessionStorage();
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

export function isSessionPersistent(): boolean {
  // Auth tokens are always shared via localStorage across tabs.
  return true;
}

export function setAccessToken(token: string, _persist = true): void {
  if (!isBrowser()) {
    return;
  }

  localStorage.setItem(ACCESS_TOKEN_KEY, token);
  sessionStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.setItem(SESSION_PERSIST_KEY, '1');
}

export function setSessionTokens(accessToken: string, refreshToken: string, _persist = true): void {
  if (!isBrowser()) {
    return;
  }

  localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  localStorage.setItem(SESSION_PERSIST_KEY, '1');

  sessionStorage.removeItem(ACCESS_TOKEN_KEY);
  sessionStorage.removeItem(REFRESH_TOKEN_KEY);
  sessionStorage.removeItem(EFFECTIVE_PERMISSION_KEYS);
  sessionStorage.removeItem(DENIED_PERMISSION_KEYS);
}

export function getStoredEffectivePermissionKeys(): string[] {
  if (!isBrowser()) {
    return [];
  }

  const rawValue =
    localStorage.getItem(EFFECTIVE_PERMISSION_KEYS) ??
    sessionStorage.getItem(EFFECTIVE_PERMISSION_KEYS);

  if (!rawValue) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawValue) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((entry) => String(entry ?? '').trim())
      .filter((entry) => entry.length > 0);
  } catch {
    return [];
  }
}

export function setStoredEffectivePermissionKeys(keys: string[], persist: boolean): void {
  if (!isBrowser()) {
    return;
  }

  const normalized = [...new Set((keys ?? []).map((entry) => String(entry ?? '').trim()))]
    .filter((entry) => entry.length > 0)
    .sort((left, right) => left.localeCompare(right));

  localStorage.setItem(EFFECTIVE_PERMISSION_KEYS, JSON.stringify(normalized));
  sessionStorage.removeItem(EFFECTIVE_PERMISSION_KEYS);
}

export function getStoredDeniedPermissionKeys(): string[] {
  if (!isBrowser()) {
    return [];
  }

  const rawValue =
    localStorage.getItem(DENIED_PERMISSION_KEYS) ??
    sessionStorage.getItem(DENIED_PERMISSION_KEYS);

  if (!rawValue) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawValue) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((entry) => String(entry ?? '').trim())
      .filter((entry) => entry.length > 0);
  } catch {
    return [];
  }
}

export function setStoredDeniedPermissionKeys(keys: string[], persist: boolean): void {
  if (!isBrowser()) {
    return;
  }

  const normalized = [...new Set((keys ?? []).map((entry) => String(entry ?? '').trim()))]
    .filter((entry) => entry.length > 0)
    .sort((left, right) => left.localeCompare(right));

  localStorage.setItem(DENIED_PERMISSION_KEYS, JSON.stringify(normalized));
  sessionStorage.removeItem(DENIED_PERMISSION_KEYS);
}

export function clearStoredEffectivePermissionKeys(): void {
  if (!isBrowser()) {
    return;
  }

  localStorage.removeItem(EFFECTIVE_PERMISSION_KEYS);
  sessionStorage.removeItem(EFFECTIVE_PERMISSION_KEYS);
}

export function clearStoredDeniedPermissionKeys(): void {
  if (!isBrowser()) {
    return;
  }

  localStorage.removeItem(DENIED_PERMISSION_KEYS);
  sessionStorage.removeItem(DENIED_PERMISSION_KEYS);
}

export function clearAccessToken(): void {
  if (!isBrowser()) {
    return;
  }

  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  localStorage.removeItem(SESSION_PERSIST_KEY);
  localStorage.removeItem(EFFECTIVE_PERMISSION_KEYS);
  localStorage.removeItem(DENIED_PERMISSION_KEYS);
  sessionStorage.removeItem(ACCESS_TOKEN_KEY);
  sessionStorage.removeItem(REFRESH_TOKEN_KEY);
  sessionStorage.removeItem(EFFECTIVE_PERMISSION_KEYS);
  sessionStorage.removeItem(DENIED_PERMISSION_KEYS);
}
