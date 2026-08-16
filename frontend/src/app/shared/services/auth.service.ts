import { Injectable } from '@angular/core';
import { apiClient } from './api-client';
import {
  clearAccessToken,
  getAccessToken,
  getRefreshToken,
  isSessionPersistent,
  setSessionTokens,
} from './auth-storage';
import { RbacService } from './rbac.service';
import { BranchService } from './branch.service';

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
  private ensureSessionPromise: Promise<boolean> | null = null;

  constructor(
    private readonly rbacService: RbacService,
    private readonly branchService: BranchService,
  ) {}

  async login(username: string, password: string, persist = true): Promise<LoginResponse> {
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
    this.branchService.reset();
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

  /**
   * Returns true when the user has a valid access token, or when a refresh
   * token can successfully restore the session.
   */
  async ensureSession(): Promise<boolean> {
    if (getAccessToken() && this.rbacService.isAuthenticated()) {
      return true;
    }

    if (this.ensureSessionPromise) {
      return this.ensureSessionPromise;
    }

    this.ensureSessionPromise = this.restoreSession().finally(() => {
      this.ensureSessionPromise = null;
    });

    return this.ensureSessionPromise;
  }

  private async restoreSession(): Promise<boolean> {
    if (getAccessToken() && this.rbacService.isAuthenticated()) {
      return true;
    }

    if (!getRefreshToken()) {
      if (getAccessToken()) {
        this.logout();
      }
      return false;
    }

    try {
      const result = await this.refreshSession();
      if (result.success && result.accessToken && this.rbacService.isAuthenticated()) {
        return true;
      }
    } catch {
      // Fall through to clear below.
    }

    this.logout();
    return false;
  }
}
