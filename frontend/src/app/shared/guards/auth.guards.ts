import { inject } from '@angular/core';
import { CanActivateChildFn, CanActivateFn, CanMatchFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { MenuKey, PermissionKey, RbacService } from '../services/rbac.service';

export const authGuard: CanActivateFn = async () => {
  const authService = inject(AuthService);
  const router = inject(Router);
  return (await authService.ensureSession()) ? true : router.createUrlTree(['/']);
};

export const authChildGuard: CanActivateChildFn = async () => {
  const authService = inject(AuthService);
  const router = inject(Router);
  return (await authService.ensureSession()) ? true : router.createUrlTree(['/']);
};

export const guestOnlyGuard: CanActivateFn = async () => {
  const authService = inject(AuthService);
  const router = inject(Router);
  return (await authService.ensureSession())
    ? router.createUrlTree(['/users/dashboard'])
    : true;
};

export const guestOnlyMatchGuard: CanMatchFn = async () => {
  const authService = inject(AuthService);
  const router = inject(Router);
  return (await authService.ensureSession())
    ? router.createUrlTree(['/users/dashboard'])
    : true;
};

export const rbacGuard: CanActivateFn = async (route) => {
  const authService = inject(AuthService);
  const rbacService = inject(RbacService);
  const router = inject(Router);

  if (!(await authService.ensureSession())) {
    return router.createUrlTree(['/']);
  }

  const menu = route.data?.['menu'] as MenuKey | undefined;
  const permission = route.data?.['permission'] as PermissionKey | undefined;

  if (!menu) {
    return true;
  }

  return rbacService.canAccess(menu, permission)
    ? true
    : router.createUrlTree(['/users/dashboard']);
};
