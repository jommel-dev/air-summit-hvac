import {
  canMarkSerialsInstalled,
  isAdminOrSuperAdminRole,
  isWarehousemanRole,
  normalizeRoleName,
} from './role-checks';

describe('role-checks', () => {
  it('normalizes role names', () => {
    expect(normalizeRoleName('  Admin  ')).toBe('admin');
  });

  it('detects admin and superadmin roles', () => {
    expect(isAdminOrSuperAdminRole('admin')).toBe(true);
    expect(isAdminOrSuperAdminRole('Super Admin')).toBe(true);
    expect(isAdminOrSuperAdminRole('superadmin')).toBe(true);
    expect(isAdminOrSuperAdminRole('warehouseman')).toBe(false);
  });

  it('detects warehouseman role variants', () => {
    expect(isWarehousemanRole('warehouseman')).toBe(true);
    expect(isWarehousemanRole('Warehouse Man')).toBe(true);
    expect(isWarehousemanRole('warehouse')).toBe(true);
    expect(isWarehousemanRole('Warehouse Staff')).toBe(true);
    expect(isWarehousemanRole('Senior Warehouseman')).toBe(true);
    expect(isWarehousemanRole('warehouse manager')).toBe(false);
    expect(isWarehousemanRole('sales')).toBe(false);
  });

  it('allows admin and warehouseman to mark serials installed', () => {
    expect(canMarkSerialsInstalled('admin')).toBe(true);
    expect(canMarkSerialsInstalled('warehouseman')).toBe(true);
    expect(canMarkSerialsInstalled('sales')).toBe(false);
  });
});
