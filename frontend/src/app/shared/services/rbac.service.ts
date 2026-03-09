import { Injectable } from '@angular/core';
import { apiClient } from './api-client';
import {
  getAccessToken,
  getStoredEffectivePermissionKeys,
  getStoredDeniedPermissionKeys,
  isSessionPersistent,
  setStoredEffectivePermissionKeys,
  setStoredDeniedPermissionKeys,
  clearStoredEffectivePermissionKeys,
  clearStoredDeniedPermissionKeys,
} from './auth-storage';

export type MenuKey =
  | 'dashboard'
  | 'sales_order'
  | 'quotation'
  | 'today_schedule'
  | 'purchase_order'
  | 'inventory'
  | 'user_management'
  | 'settings';

export type PermissionKey = 'canCreate' | 'canRead' | 'canUpdate' | 'canDelete' | 'canDoAll';

interface JwtPayload {
  sub?: string | number;
  username?: string;
  fullname?: string;
  email?: string;
  roleId?: number;
  roleName?: string;
  menus?: string;
  permissions?: string;
  iat?: number;
  exp?: number;
}

@Injectable({
  providedIn: 'root',
})
export class RbacService {
  private cachedToken: string | null = null;
  private cachedPayload: JwtPayload | null = null;
  private cachedMenus = new Set<string>();
  private cachedPermissions = new Set<string>();
  private cachedEffectivePermissionKeys = new Set<string>();
  private cachedDeniedPermissionKeys = new Set<string>();

  private readonly moduleToMenuMap: Record<string, MenuKey> = {
    dashboard: 'dashboard',
    'sales-order': 'sales_order',
    quotation: 'quotation',
    'today-schedule': 'today_schedule',
    'schedule-today-sales-order': 'today_schedule',
    'purchase-order': 'purchase_order',
    inventory: 'inventory',
    'user-management': 'user_management',
    settings: 'settings',
  };

  private refreshCache(): void {
    const token = getAccessToken();

    if (!token) {
      this.cachedToken = null;
      this.cachedPayload = null;
      this.cachedMenus = new Set<string>();
      this.cachedPermissions = new Set<string>();
      this.cachedEffectivePermissionKeys = new Set<string>();
      this.cachedDeniedPermissionKeys = new Set<string>();
      return;
    }

    if (this.cachedToken === token) {
      return;
    }

    this.cachedToken = token;

    const parts = token.split('.');
    if (parts.length !== 3) {
      this.cachedPayload = null;
      this.cachedMenus = new Set<string>();
      this.cachedPermissions = new Set<string>();
      this.cachedEffectivePermissionKeys = new Set<string>();
      this.cachedDeniedPermissionKeys = new Set<string>();
      return;
    }

    try {
      const payloadBase64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const decoded = atob(payloadBase64);
      this.cachedPayload = JSON.parse(decoded) as JwtPayload;

      const menus = this.cachedPayload?.menus ?? '';
      const legacyMenus = new Set(
        menus
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
      );

      const permissions = this.cachedPayload?.permissions ?? '';
      const legacyPermissions = new Set(
        permissions
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
      );

      this.cachedEffectivePermissionKeys = new Set(getStoredEffectivePermissionKeys());
      this.cachedDeniedPermissionKeys = new Set(getStoredDeniedPermissionKeys());
      const derived = this.deriveLegacyAccessFromEffectiveKeys(
        this.cachedEffectivePermissionKeys,
      );

      this.cachedMenus = new Set([...legacyMenus, ...derived.menus]);
      this.cachedPermissions = new Set([...legacyPermissions, ...derived.permissions]);
    } catch {
      this.cachedPayload = null;
      this.cachedMenus = new Set<string>();
      this.cachedPermissions = new Set<string>();
      this.cachedEffectivePermissionKeys = new Set<string>();
      this.cachedDeniedPermissionKeys = new Set<string>();
    }
  }

  private deriveLegacyAccessFromEffectiveKeys(effectiveKeys: Set<string>): {
    menus: Set<string>;
    permissions: Set<string>;
  } {
    const menus = new Set<string>();
    const permissions = new Set<string>();

    for (const key of effectiveKeys) {
      const normalizedKey = String(key ?? '').trim().toLowerCase();
      if (!normalizedKey) {
        continue;
      }

      if (normalizedKey.startsWith('legacy.menu.')) {
        const menuSlug = normalizedKey.replace('legacy.menu.', '');
        const mappedMenu = this.resolveMenuKeyFromSlug(menuSlug);
        if (mappedMenu) {
          menus.add(mappedMenu);
        }
      }

      if (normalizedKey.startsWith('legacy.permission.')) {
        const permissionSlug = normalizedKey.replace('legacy.permission.', '');
        const mappedPermission = this.resolvePermissionKeyFromSlug(permissionSlug);
        if (mappedPermission) {
          permissions.add(mappedPermission);
        }
      }

      const [modulePart] = normalizedKey.split('.');
      const mappedMenu = this.resolveMenuKeyFromSlug(modulePart);
      if (mappedMenu && normalizedKey.endsWith('.view')) {
        menus.add(mappedMenu);
      }

      if (normalizedKey.endsWith('.view') || normalizedKey.includes('.read')) {
        permissions.add('canRead');
      }
      if (normalizedKey.endsWith('.create')) {
        permissions.add('canCreate');
      }
      if (
        normalizedKey.endsWith('.edit') ||
        normalizedKey.endsWith('.update') ||
        normalizedKey.endsWith('.approve') ||
        normalizedKey.endsWith('.remit')
      ) {
        permissions.add('canUpdate');
      }
      if (normalizedKey.endsWith('.delete') || normalizedKey.endsWith('.remove')) {
        permissions.add('canDelete');
      }

      if (normalizedKey.includes('doall') || normalizedKey.includes('full-access')) {
        permissions.add('canDoAll');
      }
    }

    return { menus, permissions };
  }

  private resolveMenuKeyFromSlug(slug: string): MenuKey | null {
    const normalized = String(slug ?? '')
      .trim()
      .toLowerCase()
      .replace(/[_\s]+/g, '-')
      .replace(/[^a-z0-9-]/g, '');

    return this.moduleToMenuMap[normalized] ?? null;
  }

  private resolvePermissionKeyFromSlug(slug: string): PermissionKey | null {
    const normalized = String(slug ?? '')
      .trim()
      .toLowerCase()
      .replace(/[_\-\s]+/g, '');

    if (normalized.includes('doall') || normalized.includes('fullaccess')) {
      return 'canDoAll';
    }
    if (normalized.includes('create') || normalized.includes('add')) {
      return 'canCreate';
    }
    if (normalized.includes('read') || normalized.includes('view') || normalized.includes('list')) {
      return 'canRead';
    }
    if (normalized.includes('update') || normalized.includes('edit') || normalized.includes('approve')) {
      return 'canUpdate';
    }
    if (normalized.includes('delete') || normalized.includes('remove')) {
      return 'canDelete';
    }

    return null;
  }

  getUserId(): number | null {
    const payload = this.getPayload();
    const userId = Number(payload?.sub);
    return Number.isFinite(userId) && userId > 0 ? userId : null;
  }

  async syncEffectivePermissions(): Promise<boolean> {
    const userId = this.getUserId();
    if (!userId) {
      return false;
    }

    try {
      const response = await apiClient.get<{
        success: boolean;
        data?: Array<{ permissionKey: string; isAllowed: boolean }>;
      }>(`/users/${userId}/effective-permissions`);

      if (!response.data?.success) {
        return false;
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
      this.cachedToken = null;
      this.refreshCache();
      return true;
    } catch {
      return false;
    }
  }

  clearEffectivePermissionCache(): void {
    clearStoredEffectivePermissionKeys();
    clearStoredDeniedPermissionKeys();
    this.cachedToken = null;
    this.refreshCache();
  }

  getPayload(): JwtPayload | null {
    this.refreshCache();
    return this.cachedPayload;
  }

  isAuthenticated(): boolean {
    const payload = this.getPayload();
    if (!payload?.exp) {
      return false;
    }

    const nowInSeconds = Math.floor(Date.now() / 1000);
    return payload.exp > nowInSeconds;
  }

  getAllowedMenus(): Set<string> {
    this.refreshCache();
    return this.cachedMenus;
  }

  getAllowedPermissions(): Set<string> {
    this.refreshCache();
    return this.cachedPermissions;
  }

  getEffectivePermissionKeys(): Set<string> {
    this.refreshCache();
    return this.cachedEffectivePermissionKeys;
  }

  getDeniedPermissionKeys(): Set<string> {
    this.refreshCache();
    return this.cachedDeniedPermissionKeys;
  }

  hasEffectivePermissionKey(permissionKey: string): boolean {
    return this.getEffectivePermissionKeys().has(String(permissionKey ?? '').trim());
  }

  hasAnyEffectivePermissionWithPrefix(prefix: string): boolean {
    const normalizedPrefix = String(prefix ?? '').trim();
    if (!normalizedPrefix) {
      return false;
    }

    return [...this.getEffectivePermissionKeys()].some((item) => item.startsWith(normalizedPrefix));
  }

  hasDeniedPermissionKey(permissionKey: string): boolean {
    return this.getDeniedPermissionKeys().has(String(permissionKey ?? '').trim());
  }

  hasAnyDeniedPermissionWithPrefix(prefix: string): boolean {
    const normalizedPrefix = String(prefix ?? '').trim();
    if (!normalizedPrefix) {
      return false;
    }

    return [...this.getDeniedPermissionKeys()].some((item) => item.startsWith(normalizedPrefix));
  }

  hasMenu(menu: MenuKey): boolean {
    return this.getAllowedMenus().has(menu);
  }

  hasPermission(permission: PermissionKey): boolean {
    const allowed = this.getAllowedPermissions();
    return allowed.has('canDoAll') || allowed.has(permission);
  }

  canAccess(menu: MenuKey, permission?: PermissionKey): boolean {
    if (!this.isAuthenticated()) {
      return false;
    }

    if (!this.hasMenu(menu)) {
      return false;
    }

    if (!permission) {
      return true;
    }

    return this.hasPermission(permission);
  }

  getDisplayName(): string {
    const payload = this.getPayload();
    return payload?.fullname ?? payload?.username ?? 'User';
  }

  getEmail(): string {
    return this.getPayload()?.email ?? '-';
  }
}
