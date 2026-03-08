export const ACCESS_TOKEN_KEY = 'accessToken';
export const REFRESH_TOKEN_KEY = 'refreshToken';
export const SESSION_PERSIST_KEY = 'sessionPersist';
export const EFFECTIVE_PERMISSION_KEYS = 'effectivePermissionKeys';
export const DENIED_PERMISSION_KEYS = 'deniedPermissionKeys';

function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

export function getAccessToken(): string | null {
  if (!isBrowser()) {
    return null;
  }

  return localStorage.getItem(ACCESS_TOKEN_KEY) ?? sessionStorage.getItem(ACCESS_TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  if (!isBrowser()) {
    return null;
  }

  return localStorage.getItem(REFRESH_TOKEN_KEY) ?? sessionStorage.getItem(REFRESH_TOKEN_KEY);
}

export function isSessionPersistent(): boolean {
  if (!isBrowser()) {
    return false;
  }

  return localStorage.getItem(SESSION_PERSIST_KEY) === '1';
}

export function setAccessToken(token: string, persist: boolean): void {
  if (!isBrowser()) {
    return;
  }

  if (persist) {
    localStorage.setItem(ACCESS_TOKEN_KEY, token);
    sessionStorage.removeItem(ACCESS_TOKEN_KEY);
    return;
  }

  sessionStorage.setItem(ACCESS_TOKEN_KEY, token);
  localStorage.removeItem(ACCESS_TOKEN_KEY);
}

export function setSessionTokens(accessToken: string, refreshToken: string, persist: boolean): void {
  if (!isBrowser()) {
    return;
  }

  const targetStorage = persist ? localStorage : sessionStorage;
  const sourceStorage = persist ? sessionStorage : localStorage;

  targetStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  targetStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);

  sourceStorage.removeItem(ACCESS_TOKEN_KEY);
  sourceStorage.removeItem(REFRESH_TOKEN_KEY);
  sourceStorage.removeItem(EFFECTIVE_PERMISSION_KEYS);
  sourceStorage.removeItem(DENIED_PERMISSION_KEYS);

  if (persist) {
    localStorage.setItem(SESSION_PERSIST_KEY, '1');
  } else {
    localStorage.removeItem(SESSION_PERSIST_KEY);
  }
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

  const targetStorage = persist ? localStorage : sessionStorage;
  const sourceStorage = persist ? sessionStorage : localStorage;
  targetStorage.setItem(EFFECTIVE_PERMISSION_KEYS, JSON.stringify(normalized));
  sourceStorage.removeItem(EFFECTIVE_PERMISSION_KEYS);
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

  const targetStorage = persist ? localStorage : sessionStorage;
  const sourceStorage = persist ? sessionStorage : localStorage;
  targetStorage.setItem(DENIED_PERMISSION_KEYS, JSON.stringify(normalized));
  sourceStorage.removeItem(DENIED_PERMISSION_KEYS);
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
