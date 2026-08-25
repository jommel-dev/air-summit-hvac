export function normalizeRoleName(roleName: unknown): string {
  return String(roleName ?? '').trim().toLowerCase();
}

export function isAdminOrSuperAdminRole(roleName: unknown): boolean {
  const role = normalizeRoleName(roleName);
  return role === 'superadmin' || role === 'super admin' || role === 'admin';
}

export function isWarehousemanRole(roleName: unknown): boolean {
  const role = normalizeRoleName(roleName);
  const compact = role.replace(/[\s_-]+/g, '');
  if (
    compact === 'warehouse' ||
    compact === 'warehouseman' ||
    compact === 'warehousestaff'
  ) {
    return true;
  }

  return /\bwarehouse\s*man\b/.test(role) || compact.endsWith('warehouseman');
}

export function canMarkSerialsInstalled(roleName: unknown): boolean {
  return isAdminOrSuperAdminRole(roleName) || isWarehousemanRole(roleName);
}
