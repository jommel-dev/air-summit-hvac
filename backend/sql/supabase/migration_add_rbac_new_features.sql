-- Migration: Add RBAC permission keys for new features
-- Features: Database Backup, Bulk Remit

-- ============================================================
-- 1. NEW PERMISSION KEYS
-- ============================================================

INSERT INTO public.auth_permission_keys (key, label, module, scope)
VALUES
  -- Database Backup (under Settings)
  ('settings.backup.view', 'View Database Backup', 'settings', 'feature'),
  ('settings.backup.create', 'Create Database Backup', 'settings', 'action'),
  ('settings.backup.download', 'Download Database Backup', 'settings', 'action'),
  ('settings.backup.delete', 'Delete Database Backup', 'settings', 'action'),

  -- Bulk Remit (under Sales Order)
  ('sales-order.bulk-remit', 'Bulk Remit Sales Orders', 'sales-order', 'action'),
  ('sales-order.bulk-remit-installer', 'Bulk Remit All Installer Orders', 'sales-order', 'action')
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- 2. ASSIGN TO ADMIN ROLES (Superadmin, Admin, Business Owner)
-- ============================================================

-- Superadmin (role_id=1): gets ALL new permissions
INSERT INTO public.auth_role_permissions (role_id, permission_id)
SELECT 1, id FROM public.auth_permission_keys
WHERE key IN (
  'settings.backup.view',
  'settings.backup.create',
  'settings.backup.download',
  'settings.backup.delete',
  'sales-order.bulk-remit',
  'sales-order.bulk-remit-installer'
)
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Admin (role_id=2): gets ALL new permissions
INSERT INTO public.auth_role_permissions (role_id, permission_id)
SELECT 2, id FROM public.auth_permission_keys
WHERE key IN (
  'settings.backup.view',
  'settings.backup.create',
  'settings.backup.download',
  'settings.backup.delete',
  'sales-order.bulk-remit',
  'sales-order.bulk-remit-installer'
)
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Business Owner (role_id=3): gets ALL new permissions
INSERT INTO public.auth_role_permissions (role_id, permission_id)
SELECT 3, id FROM public.auth_permission_keys
WHERE key IN (
  'settings.backup.view',
  'settings.backup.create',
  'settings.backup.download',
  'settings.backup.delete',
  'sales-order.bulk-remit',
  'sales-order.bulk-remit-installer'
)
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Sales (role_id=4): only bulk remit (no backup access)
INSERT INTO public.auth_role_permissions (role_id, permission_id)
SELECT 4, id FROM public.auth_permission_keys
WHERE key IN (
  'sales-order.bulk-remit',
  'sales-order.bulk-remit-installer'
)
ON CONFLICT (role_id, permission_id) DO NOTHING;
