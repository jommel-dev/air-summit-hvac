-- ============================================================
-- Default Seed Data for HVAC Inventory & Sales Management System
-- ============================================================
-- Purpose: Provides initial data for a fresh installation including:
--   - Branches
--   - RBAC Roles
--   - Permission Keys (full catalog)
--   - Role-Permission Assignments
--   - Menu Registry
--   - Default Users (superadmin, admin, sales, user)
--   - Business Settings
--   - Account Titles (Chart of Accounts)
--
-- Prerequisites: All schema tables must exist before running this seed.
-- Safe to run multiple times (uses ON CONFLICT DO NOTHING).
-- ============================================================

BEGIN;

-- ============================================================
-- 1. BRANCHES
-- ============================================================
INSERT INTO public.tblbranches (id, "branchName", "branchAddress")
VALUES
  (1, 'Main Branch', 'Main Office Address'),
  (2, 'Branch 2', 'Branch 2 Address')
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 2. RBAC ROLES
-- ============================================================
INSERT INTO public.tblrbac (id, "roleName", "roleMenus", "rolePermission", created_by)
VALUES
  (1, 'superadmin', 'ALL', 'ALL', NULL),
  (2, 'admin', 'dashboard,projects,sales_order,purchase_order,inventory,material_inventory,quotation,customers,accounting,today_schedule,sales_order_materials,user_management,settings', 'ALL', NULL),
  (3, 'Business Owner', 'dashboard,projects,sales_order,purchase_order,inventory,material_inventory,quotation,customers,accounting,today_schedule,sales_order_materials,settings', 'ALL', NULL),
  (4, 'sales', 'dashboard,projects,sales_order,quotation,customers,today_schedule', 'sales-order.view,sales-order.create,sales-order.edit,quotation.view,quotation.create,quotation.edit,customers.view,customers.create,projects.view', NULL),
  (5, 'user', 'dashboard', 'dashboard.view', NULL)
ON CONFLICT (id) DO NOTHING;

SELECT setval(pg_get_serial_sequence('public.tblrbac', 'id'), GREATEST((SELECT MAX(id) FROM public.tblrbac), 5));

-- ============================================================
-- 3. PERMISSION KEYS (Full Catalog)
-- ============================================================
INSERT INTO public.auth_permission_keys (key, label, module, scope)
VALUES
  -- Dashboard
  ('dashboard.view', 'View Dashboard', 'dashboard', 'feature'),

  -- User Management
  ('user-management.view', 'View User Management', 'user-management', 'feature'),
  ('user-management.create', 'Create User', 'user-management', 'action'),
  ('user-management.edit', 'Edit User', 'user-management', 'action'),
  ('user-management.delete', 'Delete User', 'user-management', 'action'),

  -- Sales Order
  ('sales-order.view', 'View Sales Orders', 'sales-order', 'feature'),
  ('sales-order.create', 'Create Sales Order', 'sales-order', 'action'),
  ('sales-order.edit', 'Edit Sales Order', 'sales-order', 'action'),
  ('sales-order.remit', 'Remit Sales', 'sales-order', 'action'),
  ('sales-order.print-dr', 'Print Delivery Receipt', 'sales-order', 'action'),
  ('sales-order.tab.schedules', 'SO Tab: Schedules', 'sales-order', 'tab'),
  ('sales-order.tab.sub-dealers', 'SO Tab: Sub Dealers', 'sales-order', 'tab'),
  ('sales-order.tab.services', 'SO Tab: Services', 'sales-order', 'tab'),
  ('sales-order.tab.projects', 'SO Tab: Projects', 'sales-order', 'tab'),
  ('sales-order.tab.distribution', 'SO Tab: Distribution', 'sales-order', 'tab'),
  ('sales-order.tab.sales-receivable', 'SO Tab: Sales Receivable', 'sales-order', 'tab'),
  ('sales-order.tab.remitted-sales', 'SO Tab: Remitted Sales', 'sales-order', 'tab'),

  -- Purchase Order
  ('purchase-order.view', 'View Purchase Orders', 'purchase-order', 'feature'),
  ('purchase-order.create', 'Create Purchase Order', 'purchase-order', 'action'),
  ('purchase-order.edit', 'Edit Purchase Order', 'purchase-order', 'action'),
  ('purchase-order.approve', 'Approve Purchase Order', 'purchase-order', 'action'),
  ('purchase-order.tab.local', 'PO Tab: Local', 'purchase-order', 'tab'),
  ('purchase-order.tab.imported', 'PO Tab: Imported', 'purchase-order', 'tab'),
  ('purchase-order.tab.deliveries', 'PO Tab: Deliveries', 'purchase-order', 'tab'),
  ('purchase-order.tab.approvals', 'PO Tab: Approvals', 'purchase-order', 'tab'),
  ('purchase-order.tab.master-data', 'PO Tab: Master Data', 'purchase-order', 'tab'),
  ('purchase-order.button.send-for-approval', 'PO Action: Send for Approval', 'purchase-order', 'action'),
  ('purchase-order.button.revert-deliveries', 'PO Action: Revert to Deliveries', 'purchase-order', 'action'),

  -- Customers
  ('customers.view', 'View Customers', 'customers', 'feature'),
  ('customers.create', 'Create Customer', 'customers', 'action'),
  ('customers.edit', 'Edit Customer', 'customers', 'action'),
  ('customers.delete', 'Delete Customer', 'customers', 'action'),

  -- Inventory
  ('inventory.view', 'View Inventory', 'inventory', 'feature'),
  ('inventory.create', 'Create Inventory Item', 'inventory', 'action'),
  ('inventory.edit', 'Edit Inventory Item', 'inventory', 'action'),
  ('inventory.land-costing.view', 'Inventory: View Land Costing Report', 'inventory', 'feature'),
  ('inventory.land-costing.margin.view', 'Inventory: View Land Costing Margin', 'inventory', 'feature'),
  ('inventory.land-costing.export', 'Inventory: Export Land Costing Report', 'inventory', 'action'),

  -- Material Inventory
  ('material-inventory.view', 'View Material Inventory', 'material-inventory', 'feature'),
  ('material-inventory.create', 'Create Material', 'material-inventory', 'action'),
  ('material-inventory.edit', 'Edit Material', 'material-inventory', 'action'),
  ('material-inventory.stock-in', 'Material Stock In', 'material-inventory', 'action'),
  ('material-inventory.stock-out', 'Material Stock Out', 'material-inventory', 'action'),

  -- Quotation
  ('quotation.view', 'View Quotations', 'quotation', 'feature'),
  ('quotation.create', 'Create Quotation', 'quotation', 'action'),
  ('quotation.edit', 'Edit Quotation', 'quotation', 'action'),
  ('quotation.finalize', 'Finalize Quotation', 'quotation', 'action'),
  ('quotation.convert', 'Convert Quotation to SO', 'quotation', 'action'),
  ('quotation.print', 'Print Quotation', 'quotation', 'action'),

  -- Projects
  ('projects.view', 'View Projects', 'projects', 'feature'),
  ('projects.create', 'Create Project', 'projects', 'action'),
  ('projects.edit', 'Edit Project', 'projects', 'action'),
  ('projects.delete', 'Delete Project', 'projects', 'action'),

  -- Accounting
  ('accounting.view', 'View Accounting Module', 'accounting', 'feature'),
  ('accounting.report.cheque-voucher.view', 'Report: Cheque Voucher', 'accounting', 'feature'),
  ('accounting.report.general-journal-register.view', 'Report: General Journal Register', 'accounting', 'feature'),
  ('accounting.report.disbursement-register.view', 'Report: Disbursement Register', 'accounting', 'feature'),
  ('accounting.report.sales-register.view', 'Report: Sales Register', 'accounting', 'feature'),
  ('accounting.report.tax-2307-report.view', 'Report: 2307 Tax Report', 'accounting', 'feature'),
  ('accounting.report.weekly-sales.view', 'Report: Weekly Sales', 'accounting', 'feature'),
  ('accounting.report.daily-unit-released.view', 'Report: Daily Unit Released', 'accounting', 'feature'),
  ('accounting.report.low-stocks-report.view', 'Report: Low Stocks', 'accounting', 'feature'),
  ('accounting.report.action.generate', 'Action: Generate Report', 'accounting', 'action'),
  ('accounting.report.action.export', 'Action: Export Report', 'accounting', 'action'),
  ('accounting.report.action.print', 'Action: Print Report', 'accounting', 'action'),
  ('accounting.report.action.edit-draft', 'Action: Edit Draft Workflows', 'accounting', 'action'),

  -- Settings
  ('settings.view', 'View Settings', 'settings', 'feature'),
  ('settings.edit', 'Edit Settings', 'settings', 'action'),

  -- Legacy menu tokens (backward compatibility)
  ('legacy.menu.dashboard', 'Legacy Menu: Dashboard', 'legacy', 'menu'),
  ('legacy.menu.sales_order', 'Legacy Menu: Sales Order', 'legacy', 'menu'),
  ('legacy.menu.purchase_order', 'Legacy Menu: Purchase Order', 'legacy', 'menu'),
  ('legacy.menu.inventory', 'Legacy Menu: Inventory', 'legacy', 'menu'),
  ('legacy.menu.material_inventory', 'Legacy Menu: Material Inventory', 'legacy', 'menu'),
  ('legacy.menu.quotation', 'Legacy Menu: Quotation', 'legacy', 'menu'),
  ('legacy.menu.customers', 'Legacy Menu: Customers', 'legacy', 'menu'),
  ('legacy.menu.projects', 'Legacy Menu: Projects', 'legacy', 'menu'),
  ('legacy.menu.accounting', 'Legacy Menu: Accounting', 'legacy', 'menu'),
  ('legacy.menu.today_schedule', 'Legacy Menu: Today Schedule', 'legacy', 'menu'),
  ('legacy.menu.sales_order_materials', 'Legacy Menu: SO Materials', 'legacy', 'menu'),
  ('legacy.menu.user_management', 'Legacy Menu: User Management', 'legacy', 'menu'),
  ('legacy.menu.settings', 'Legacy Menu: Settings', 'legacy', 'menu')
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- 4. ROLE-PERMISSION ASSIGNMENTS
-- ============================================================

-- Superadmin (role_id=1): gets ALL permissions
INSERT INTO public.auth_role_permissions (role_id, permission_id)
SELECT 1, id FROM public.auth_permission_keys
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Admin (role_id=2): gets ALL permissions
INSERT INTO public.auth_role_permissions (role_id, permission_id)
SELECT 2, id FROM public.auth_permission_keys
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Business Owner (role_id=3): gets ALL permissions
INSERT INTO public.auth_role_permissions (role_id, permission_id)
SELECT 3, id FROM public.auth_permission_keys
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Sales (role_id=4): limited permissions
INSERT INTO public.auth_role_permissions (role_id, permission_id)
SELECT 4, id FROM public.auth_permission_keys
WHERE key IN (
  'dashboard.view',
  'sales-order.view',
  'sales-order.create',
  'sales-order.edit',
  'sales-order.print-dr',
  'sales-order.tab.schedules',
  'sales-order.tab.sub-dealers',
  'sales-order.tab.projects',
  'quotation.view',
  'quotation.create',
  'quotation.edit',
  'quotation.finalize',
  'quotation.print',
  'customers.view',
  'customers.create',
  'customers.edit',
  'projects.view',
  'legacy.menu.dashboard',
  'legacy.menu.sales_order',
  'legacy.menu.quotation',
  'legacy.menu.customers',
  'legacy.menu.projects',
  'legacy.menu.today_schedule'
)
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- User (role_id=5): minimal permissions
INSERT INTO public.auth_role_permissions (role_id, permission_id)
SELECT 5, id FROM public.auth_permission_keys
WHERE key IN (
  'dashboard.view',
  'legacy.menu.dashboard'
)
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ============================================================
-- 5. MENU REGISTRY
-- ============================================================
INSERT INTO public.auth_menus (key, label, parent_key, route, icon, order_no)
VALUES
  ('dashboard', 'Dashboard', NULL, '/users/dashboard', 'dashboard', 1),
  ('projects', 'Projects', NULL, '/users/projects', 'folder', 2),
  ('sales_order', 'Sales Order', NULL, '/users/sales-order', 'shopping_cart', 3),
  ('quotation', 'Quotation', NULL, '/users/quotation', 'description', 4),
  ('customers', 'Customer & Dealer', NULL, '/users/customers', 'people', 5),
  ('today_schedule', 'Today Schedule', NULL, '/users/schedule-today-sales-order', 'event', 6),
  ('purchase_order', 'Purchase Order', NULL, '/users/purchase-order', 'local_shipping', 7),
  ('inventory', 'Inventory', NULL, '/users/inventory', 'inventory_2', 8),
  ('material_inventory', 'Material Inventory', NULL, '/users/material-inventory', 'category', 9),
  ('sales_order_materials', 'SO Materials', NULL, '/users/sales-order-materials', 'build', 10),
  ('accounting', 'Accounting', NULL, '/users/accounting', 'account_balance', 11),
  ('user_management', 'User Management', NULL, '/users/user-management', 'manage_accounts', 12),
  ('settings', 'Settings', NULL, '/users/settings', 'settings', 99)
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- 6. DEFAULT USERS
-- ============================================================
-- Passwords are bcrypt hashes. Change after first login!
-- Default password for all users: "password123"
-- bcrypt hash: $2b$10$8KzaNdKIMyOkASCBFOJl4.gEL0Rl4myFGOK5aPYXOq.HEALING.HASH
-- NOTE: Replace with actual bcrypt hashes generated by your application.

-- Superadmin user
INSERT INTO public.tblusers (id, username, password, fullname, email, "roleId", "branchId", status, is_deleted)
VALUES (
  1,
  'superadmin',
  '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
  'System Superadmin',
  'superadmin@hvac-system.com',
  1,
  1,
  1,
  false
)
ON CONFLICT (id) DO NOTHING;

-- Admin user
INSERT INTO public.tblusers (id, username, password, fullname, email, "roleId", "branchId", status, is_deleted)
VALUES (
  2,
  'admin',
  '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
  'System Admin',
  'admin@hvac-system.com',
  2,
  1,
  1,
  false
)
ON CONFLICT (id) DO NOTHING;

-- Sales user
INSERT INTO public.tblusers (id, username, password, fullname, email, "roleId", "branchId", status, is_deleted)
VALUES (
  3,
  'sales01',
  '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
  'Sales Staff 01',
  'sales01@hvac-system.com',
  4,
  1,
  1,
  false
)
ON CONFLICT (id) DO NOTHING;

-- Regular user
INSERT INTO public.tblusers (id, username, password, fullname, email, "roleId", "branchId", status, is_deleted)
VALUES (
  4,
  'user01',
  '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
  'Regular User 01',
  'user01@hvac-system.com',
  5,
  1,
  1,
  false
)
ON CONFLICT (id) DO NOTHING;

SELECT setval(pg_get_serial_sequence('public.tblusers', 'id'), GREATEST((SELECT MAX(id) FROM public.tblusers), 4));

-- Backfill auth_user_roles
INSERT INTO public.auth_user_roles (user_id, role_id, is_primary)
VALUES
  (1, 1, true),
  (2, 2, true),
  (3, 4, true),
  (4, 5, true)
ON CONFLICT (user_id, role_id) DO NOTHING;

-- ============================================================
-- 7. BUSINESS SETTINGS (Single-row configuration)
-- ============================================================
INSERT INTO public.tblsettings (
  id,
  "businessName",
  "businessAddress",
  "businessEmail",
  "businessContact",
  "businessTIN",
  "businessOwner",
  "businessLogo",
  cv_number_prefix,
  cv_number_suffix,
  gj_number_prefix,
  gj_number_suffix
)
VALUES (
  1,
  'HVAC Solutions Inc.',
  '123 Main Street, Business District, Metro City',
  'info@hvacsolutions.com',
  '+63 912 345 6789',
  '123-456-789-000',
  'Juan Dela Cruz',
  NULL,
  'CV',
  '',
  'GJ',
  ''
)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 8. ACCOUNT TITLES (Chart of Accounts)
-- ============================================================
INSERT INTO public.tblaccount_titles (account_number, description, is_active)
VALUES
  -- Assets
  ('11001', 'Cash In Bank', TRUE),
  ('11002', 'Petty Cash', TRUE),
  ('11003', 'Cash on Hand', TRUE),
  ('12001', 'Expanded Withholding Tax', TRUE),
  ('12002', 'Accounts Receivable', TRUE),
  ('12003', 'Advances to Employees', TRUE),
  ('13001', 'Inventory - Units', TRUE),
  ('13002', 'Inventory - Materials', TRUE),

  -- Liabilities
  ('21001', 'Accounts Payable', TRUE),
  ('21002', 'Withholding Tax Payable', TRUE),
  ('21003', 'VAT Payable', TRUE),

  -- Expenses / Cost
  ('14001', 'Purchases', TRUE),
  ('14010', 'Input Tax', TRUE),
  ('15001', 'DC-Outside Services', TRUE),
  ('15002', 'DC-Materials', TRUE),
  ('15003', 'DC-Others', TRUE),
  ('15004', 'DC-Labor', TRUE),
  ('15005', 'DC-Transportation', TRUE),

  -- Revenue
  ('41001', 'Sales Revenue', TRUE),
  ('41002', 'Service Revenue', TRUE),

  -- Operating Expenses
  ('51001', 'Salaries and Wages', TRUE),
  ('51002', 'Utilities Expense', TRUE),
  ('51003', 'Rent Expense', TRUE),
  ('51004', 'Office Supplies', TRUE),
  ('51005', 'Transportation Expense', TRUE),
  ('51006', 'Representation Expense', TRUE),
  ('51007', 'Communication Expense', TRUE),
  ('51008', 'Depreciation Expense', TRUE),
  ('51009', 'Miscellaneous Expense', TRUE)
ON CONFLICT (account_number, description) DO UPDATE
SET is_active = TRUE, updated_at = NOW();

-- ============================================================
-- 9. SAMPLE BRANDS (HVAC Brands)
-- ============================================================
INSERT INTO public.tblbrands (id, "brandName", prefix)
VALUES
  (1, 'Daikin', 'DKN'),
  (2, 'Carrier', 'CRR'),
  (3, 'Panasonic', 'PNS'),
  (4, 'Samsung', 'SMS'),
  (5, 'LG', 'LG'),
  (6, 'Midea', 'MDA'),
  (7, 'Koppel', 'KPL'),
  (8, 'Condura', 'CDR')
ON CONFLICT (id) DO NOTHING;

SELECT setval(pg_get_serial_sequence('public.tblbrands', 'id'), GREATEST((SELECT MAX(id) FROM public.tblbrands), 8));

-- ============================================================
-- 10. SAMPLE MATERIAL ITEMS
-- ============================================================
INSERT INTO public.tblmaterial_items (code, name, unit, is_active)
VALUES
  ('MAT-COP-001', 'Copper Pipe 1/4"', 'meter', true),
  ('MAT-COP-002', 'Copper Pipe 3/8"', 'meter', true),
  ('MAT-COP-003', 'Copper Pipe 1/2"', 'meter', true),
  ('MAT-COP-004', 'Copper Pipe 5/8"', 'meter', true),
  ('MAT-COP-005', 'Copper Pipe 3/4"', 'meter', true),
  ('MAT-INS-001', 'Insulation Foam 1/4"', 'meter', true),
  ('MAT-INS-002', 'Insulation Foam 3/8"', 'meter', true),
  ('MAT-INS-003', 'Insulation Foam 1/2"', 'meter', true),
  ('MAT-WIR-001', 'Signal Wire 4-core', 'meter', true),
  ('MAT-WIR-002', 'Power Wire 2.0mm', 'meter', true),
  ('MAT-WIR-003', 'Power Wire 3.5mm', 'meter', true),
  ('MAT-DRN-001', 'Drain Hose 5/8"', 'meter', true),
  ('MAT-DRN-002', 'Drain Pipe PVC 3/4"', 'pcs', true),
  ('MAT-BRK-001', 'Wall Bracket (Standard)', 'pcs', true),
  ('MAT-BRK-002', 'Wall Bracket (Heavy Duty)', 'pcs', true),
  ('MAT-TPS-001', 'Teflon Tape', 'pcs', true),
  ('MAT-FLR-001', 'Flaring Nut 1/4"', 'pcs', true),
  ('MAT-FLR-002', 'Flaring Nut 3/8"', 'pcs', true),
  ('MAT-FLR-003', 'Flaring Nut 1/2"', 'pcs', true),
  ('MAT-PVC-001', 'PVC Elbow 3/4"', 'pcs', true),
  ('MAT-PVC-002', 'PVC Tee 3/4"', 'pcs', true),
  ('MAT-CBR-001', 'Circuit Breaker 20A', 'pcs', true),
  ('MAT-CBR-002', 'Circuit Breaker 30A', 'pcs', true),
  ('MAT-CBR-003', 'Circuit Breaker 40A', 'pcs', true)
ON CONFLICT (code) DO NOTHING;

COMMIT;

-- ============================================================
-- NOTES:
-- ============================================================
-- 1. Default password for all seeded users is "password123"
--    The bcrypt hash used is a placeholder. Generate real hashes
--    using your application's auth service before production use.
--
-- 2. After running this seed, log in as 'superadmin' and:
--    - Update the business settings with real company info
--    - Change all default passwords
--    - Add real branch addresses
--    - Configure document numbering prefixes as needed
--
-- 3. The material items are common HVAC installation materials.
--    Add more specific items through the Material Inventory UI.
--
-- 4. Account titles follow a simplified chart of accounts.
--    Customize based on your actual accounting requirements.
-- ============================================================
