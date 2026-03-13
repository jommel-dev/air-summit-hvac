import axios, { AxiosHeaders, InternalAxiosRequestConfig } from 'axios';
import {
  clearAccessToken,
  getAccessToken,
  getRefreshToken,
  isSessionPersistent,
  setSessionTokens,
  setStoredDeniedPermissionKeys,
  setStoredEffectivePermissionKeys,
} from './auth-storage';

type RetryConfig = InternalAxiosRequestConfig & { _retry?: boolean };

const appEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
const configuredApiBaseUrl = String(appEnv?.['NG_APP_API_BASE_URL'] ?? '').trim();
const nodeEnv = String(appEnv?.['NODE_ENV'] ?? '').trim().toLowerCase();
const hostName = String(globalThis.location?.hostname ?? '').trim().toLowerCase();
const isLocalHost = hostName === 'localhost' || hostName === '127.0.0.1';
const isProductionBuild = nodeEnv === 'production' || !isLocalHost;
const fallbackProductionApiBaseUrl = 'https://air-summit-backend-ewbho.ondigitalocean.app';

if (!configuredApiBaseUrl && isProductionBuild) {
  console.warn(
    'NG_APP_API_BASE_URL is missing. Falling back to the configured production API URL.',
  );
}

const API_BASE_URL = configuredApiBaseUrl || (isLocalHost ? 'http://localhost:3000' : fallbackProductionApiBaseUrl);

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

let isRefreshing = false;
let refreshQueue: Array<(token: string | null) => void> = [];

function notifyRefreshQueue(token: string | null): void {
  refreshQueue.forEach((resolve) => resolve(token));
  refreshQueue = [];
}

function extractUserIdFromJwt(token: string): number | null {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }

  try {
    const payloadBase64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const decoded = atob(payloadBase64);
    const payload = JSON.parse(decoded) as { sub?: string | number };
    const userId = Number(payload?.sub);
    return Number.isFinite(userId) && userId > 0 ? userId : null;
  } catch {
    return null;
  }
}

async function syncEffectivePermissionKeysWithToken(accessToken: string): Promise<void> {
  const userId = extractUserIdFromJwt(accessToken);
  if (!userId) {
    return;
  }

  try {
    const response = await axios.get<{
      success: boolean;
      data?: Array<{ permissionKey: string; isAllowed: boolean }>;
    }>(`${API_BASE_URL}/users/${userId}/effective-permissions`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.data?.success) {
      return;
    }

    const keys = (response.data.data ?? [])
      .filter((item) => item.isAllowed)
      .map((item) => String(item.permissionKey ?? '').trim())
      .filter((item) => item.length > 0);

    const deniedKeys = (response.data.data ?? [])
      .filter((item) => !item.isAllowed)
      .map((item) => String(item.permissionKey ?? '').trim())
      .filter((item) => item.length > 0);

    setStoredEffectivePermissionKeys(keys, isSessionPersistent());
    setStoredDeniedPermissionKeys(deniedKeys, isSessionPersistent());
  } catch {
  }
}

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) {
    return null;
  }

  try {
    const response = await axios.post<{
      success: boolean;
      accessToken?: string;
      refreshToken?: string;
    }>(`${API_BASE_URL}/login/refresh`, { refreshToken });

    if (response.data.success && response.data.accessToken && response.data.refreshToken) {
      setSessionTokens(
        response.data.accessToken,
        response.data.refreshToken,
        isSessionPersistent(),
      );

      void syncEffectivePermissionKeysWithToken(response.data.accessToken);

      return response.data.accessToken;
    }

    return null;
  } catch {
    return null;
  }
}

apiClient.interceptors.request.use((config) => {
  const token = getAccessToken();

  if (token) {
    config.headers ??= new AxiosHeaders();

    if (config.headers instanceof AxiosHeaders) {
      config.headers.set('Authorization', `Bearer ${token}`);
    } else {
      (config.headers as Record<string, string>)['Authorization'] = `Bearer ${token}`;
    }
  }

  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const status = error?.response?.status as number | undefined;
    const originalRequest = error?.config as RetryConfig | undefined;

    if (status !== 401 || !originalRequest || originalRequest._retry) {
      if (status === 401) {
        clearAccessToken();
      }
      return Promise.reject(error);
    }

    originalRequest._retry = true;

    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        refreshQueue.push((newToken) => {
          if (!newToken) {
            reject(error);
            return;
          }

          originalRequest.headers ??= new AxiosHeaders();
          if (originalRequest.headers instanceof AxiosHeaders) {
            originalRequest.headers.set('Authorization', `Bearer ${newToken}`);
          } else {
            (originalRequest.headers as Record<string, string>)['Authorization'] =
              `Bearer ${newToken}`;
          }

          resolve(apiClient(originalRequest));
        });
      });
    }

    isRefreshing = true;

    try {
      const nextToken = await refreshAccessToken();
      if (!nextToken) {
        clearAccessToken();
        notifyRefreshQueue(null);
        return Promise.reject(error);
      }

      notifyRefreshQueue(nextToken);
      originalRequest.headers ??= new AxiosHeaders();
      if (originalRequest.headers instanceof AxiosHeaders) {
        originalRequest.headers.set('Authorization', `Bearer ${nextToken}`);
      } else {
        (originalRequest.headers as Record<string, string>)['Authorization'] =
          `Bearer ${nextToken}`;
      }

      return apiClient(originalRequest);
    } finally {
      isRefreshing = false;
    }
  },
);
