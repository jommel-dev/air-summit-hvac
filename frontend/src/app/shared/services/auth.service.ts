import { Injectable } from '@angular/core';
import { apiClient } from './api-client';
import {
  clearAccessToken,
  getRefreshToken,
  isSessionPersistent,
  setSessionTokens,
} from './auth-storage';
import { RbacService } from './rbac.service';

export interface LoginResponse {
  success: boolean;
  accessToken?: string;
  refreshToken?: string;
  message?: string;
  role?: {
    id: number | null;
    name: string | null;
    menus: string | null;
    permissions: string | null;
  };
}

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  constructor(private readonly rbacService: RbacService) {}

  async login(username: string, password: string, persist = false): Promise<LoginResponse> {
    const response = await apiClient.post<LoginResponse>('/login', {
      username,
      password,
    });

    if (response.data.success && response.data.accessToken && response.data.refreshToken) {
      setSessionTokens(response.data.accessToken, response.data.refreshToken, persist);
      await this.rbacService.syncEffectivePermissions();
    }

    return response.data;
  }

  logout(): void {
    this.rbacService.clearEffectivePermissionCache();
    clearAccessToken();
  }

  async refreshSession(): Promise<LoginResponse> {
    const refreshToken = getRefreshToken();
    if (!refreshToken) {
      return {
        success: false,
        message: 'No refresh token available',
      };
    }

    const response = await apiClient.post<LoginResponse>('/login/refresh', {
      refreshToken,
    });

    if (response.data.success && response.data.accessToken && response.data.refreshToken) {
      setSessionTokens(
        response.data.accessToken,
        response.data.refreshToken,
        isSessionPersistent(),
      );
      await this.rbacService.syncEffectivePermissions();
    }

    return response.data;
  }
}
