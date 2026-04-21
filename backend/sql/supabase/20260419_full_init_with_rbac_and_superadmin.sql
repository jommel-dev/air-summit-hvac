-- Full Database Migration with Normalized RBAC and Default Superadmin
-- Generated: 2026-04-19

BEGIN;

-- 1. Branches
CREATE TABLE IF NOT EXISTS public.tblbranches (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  branchName VARCHAR(255),
  branchAddress TEXT
);

-- 2. RBAC Roles
CREATE TABLE IF NOT EXISTS public.tblrbac (
  id BIGSERIAL PRIMARY KEY,
  roleName VARCHAR(50) UNIQUE,
  roleMenus TEXT,
  rolePermission TEXT,
  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Users
CREATE TABLE IF NOT EXISTS public.tblusers (
  id BIGSERIAL PRIMARY KEY,
  username VARCHAR(50) UNIQUE,
  password TEXT,
  fullname VARCHAR(100),
  birthdate DATE,
  address TEXT,
  email VARCHAR(100),
  contact VARCHAR(50),
  status SMALLINT,
  is_deleted BOOLEAN,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  created_by BIGINT DEFAULT 1,
  roleId BIGINT DEFAULT 1 REFERENCES public.tblrbac(id) ON DELETE SET NULL,
  branchId BIGINT REFERENCES public.tblbranches(id) ON DELETE SET NULL
);

-- 4. Permission Dictionary
CREATE TABLE IF NOT EXISTS public.auth_permission_keys (
  id BIGSERIAL PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  module TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'feature',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT auth_permission_keys_scope_check CHECK (scope IN ('feature', 'menu', 'tab', 'action'))
);

-- 5. Role -> Permission Mapping
CREATE TABLE IF NOT EXISTS public.auth_role_permissions (
  id BIGSERIAL PRIMARY KEY,
  role_id BIGINT NOT NULL REFERENCES public.tblrbac(id) ON DELETE CASCADE,
  permission_id BIGINT NOT NULL REFERENCES public.auth_permission_keys(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(role_id, permission_id)
);

-- 6. User-level Permission Overrides
CREATE TABLE IF NOT EXISTS public.auth_user_permission_overrides (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES public.tblusers(id) ON DELETE CASCADE,
  permission_id BIGINT NOT NULL REFERENCES public.auth_permission_keys(id) ON DELETE CASCADE,
  effect TEXT NOT NULL, -- allow | deny
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. Menu Registry (optional, for menu-driven UI)
CREATE TABLE IF NOT EXISTS public.auth_menus (
  id BIGSERIAL PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  parent_key TEXT,
  route TEXT,
  icon TEXT,
  order_no INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. Seed Roles
INSERT INTO public.tblrbac (id, roleName, roleMenus, rolePermission, created_by)
VALUES
  (1, 'superadmin', 'ALL', 'ALL', NULL),
  (2, 'admin', 'dashboard,projects,sales,inventory,settings', 'ALL', NULL),
  (3, 'sales', 'dashboard,projects,sales', 'projects.view,sales.view', NULL),
  (4, 'user', 'dashboard', 'projects.view', NULL)
ON CONFLICT (id) DO NOTHING;

-- 9. Seed Menus
INSERT INTO public.auth_menus (key, label, parent_key, route, icon, order_no)
VALUES
  ('dashboard', 'Dashboard', NULL, '/dashboard', 'dashboard', 1),
  ('projects', 'Projects', NULL, '/projects', 'folder', 2),
  ('sales', 'Sales Orders', NULL, '/sales', 'shopping_cart', 3),
  ('inventory', 'Inventory', NULL, '/inventory', 'inventory', 4),
  ('settings', 'Settings', NULL, '/settings', 'settings', 99)
ON CONFLICT (key) DO NOTHING;

-- 10. Seed Permissions (features, menus, tabs, actions)
INSERT INTO public.auth_permission_keys(key, label, module, scope)
VALUES
  ('dashboard.view', 'View Dashboard', 'dashboard', 'feature'),
  ('projects.view', 'View Projects', 'projects', 'feature'),
  ('projects.create', 'Create Project', 'projects', 'action'),
  ('projects.edit', 'Edit Project', 'projects', 'action'),
  ('projects.delete', 'Delete Project', 'projects', 'action'),
  ('sales.view', 'View Sales Orders', 'sales', 'feature'),
  ('sales.create', 'Create Sales Order', 'sales', 'action'),
  ('sales.edit', 'Edit Sales Order', 'sales', 'action'),
  ('sales.delete', 'Delete Sales Order', 'sales', 'action'),
  ('inventory.view', 'View Inventory', 'inventory', 'feature'),
  ('settings.view', 'View Settings', 'settings', 'feature'),
  ('settings.edit', 'Edit Settings', 'settings', 'action')
ON CONFLICT (key) DO NOTHING;

-- 11. Seed Role-Permission Assignments (superadmin gets all, others get relevant)
INSERT INTO public.auth_role_permissions (role_id, permission_id)
SELECT 1, id FROM public.auth_permission_keys ON CONFLICT DO NOTHING;

INSERT INTO public.auth_role_permissions (role_id, permission_id)
SELECT 2, id FROM public.auth_permission_keys WHERE key LIKE 'dashboard.%' OR key LIKE 'projects.%' OR key LIKE 'sales.%' OR key LIKE 'inventory.%' OR key LIKE 'settings.%' ON CONFLICT DO NOTHING;

INSERT INTO public.auth_role_permissions (role_id, permission_id)
SELECT 3, id FROM public.auth_permission_keys WHERE key IN ('dashboard.view','projects.view','sales.view') ON CONFLICT DO NOTHING;

INSERT INTO public.auth_role_permissions (role_id, permission_id)
SELECT 4, id FROM public.auth_permission_keys WHERE key IN ('dashboard.view','projects.view') ON CONFLICT DO NOTHING;

-- 12. Seed Default Superadmin User
INSERT INTO public.tblusers (id, username, password, fullname, email, roleId, status)
VALUES (1, 'superadmin', '$2b$10$wJvQwQwQwQwQwQwQwQwQwOeQwQwQwQwQwQwQwQwQwQwQwQwQwQw', 'System Superadmin', 'superadmin@yourdomain.com', 1, 1)
ON CONFLICT (id) DO NOTHING;
-- Password is bcrypt hash for 'superadmin' (change after first login!)

COMMIT;
