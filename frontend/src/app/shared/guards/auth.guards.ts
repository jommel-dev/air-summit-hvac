import { inject } from '@angular/core';
import { CanActivateChildFn, CanActivateFn, CanMatchFn, Router, UrlTree } from '@angular/router';
import { getAccessToken } from '../services/auth-storage';
import { MenuKey, PermissionKey, RbacService } from '../services/rbac.service';

function hasToken(): boolean {
  return Boolean(getAccessToken());
}

function toDashboard(): UrlTree {
  const router = inject(Router);
  return router.createUrlTree(['/users/dashboard']);
}

function toLogin(): UrlTree {
  const router = inject(Router);
  return router.createUrlTree(['/']);
}

export const authGuard: CanActivateFn = () => {
  return hasToken() ? true : toLogin();
};

export const authChildGuard: CanActivateChildFn = () => {
  return hasToken() ? true : toLogin();
};

export const guestOnlyGuard: CanActivateFn = () => {
  return hasToken() ? toDashboard() : true;
};

export const guestOnlyMatchGuard: CanMatchFn = () => {
  return hasToken() ? toDashboard() : true;
};

export const rbacGuard: CanActivateFn = (route) => {
  const rbacService = inject(RbacService);

  const menu = route.data?.['menu'] as MenuKey | undefined;
  const permission = route.data?.['permission'] as PermissionKey | undefined;

  if (!menu) {
    return rbacService.isAuthenticated() ? true : toLogin();
  }

  return rbacService.canAccess(menu, permission) ? true : toDashboard();
};
