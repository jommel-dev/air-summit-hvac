-- Business Owner role + RBAC expansion (Accounting + Inventory Land Costing)
-- Date: 2026-03-22

BEGIN;

-- 1) Ensure permission keys exist for Accounting, Inventory Land Costing, and latest PO actions/tabs.
INSERT INTO public.auth_permission_keys(key, label, module, scope)
VALUES
  ('accounting.view', 'View Accounting Module', 'accounting', 'feature'),
  ('accounting.report.cheque-voucher.view', 'Accounting Report: Cheque Voucher', 'accounting', 'feature'),
  ('accounting.report.general-journal-register.view', 'Accounting Report: General Journal Register', 'accounting', 'feature'),
  ('accounting.report.disbursement-register.view', 'Accounting Report: Disbursement Register', 'accounting', 'feature'),
  ('accounting.report.sales-register.view', 'Accounting Report: Sales Register', 'accounting', 'feature'),
  ('accounting.report.tax-2307-report.view', 'Accounting Report: 2307 Tax Report', 'accounting', 'feature'),
  ('accounting.report.weekly-sales.view', 'Accounting Report: Weekly Sales', 'accounting', 'feature'),
  ('accounting.report.daily-unit-released.view', 'Accounting Report: Daily Unit Released', 'accounting', 'feature'),
  ('accounting.report.low-stocks-report.view', 'Accounting Report: Low Stocks', 'accounting', 'feature'),

  ('accounting.report.action.generate', 'Accounting Action: Generate Report', 'accounting', 'action'),
  ('accounting.report.action.export', 'Accounting Action: Export Report', 'accounting', 'action'),
  ('accounting.report.action.print', 'Accounting Action: Print Report', 'accounting', 'action'),
  ('accounting.report.action.edit-draft', 'Accounting Action: Edit Draft Workflows', 'accounting', 'action'),

  ('inventory.land-costing.view', 'Inventory: View Land Costing Report', 'inventory', 'feature'),
  ('inventory.land-costing.margin.view', 'Inventory: View Land Costing Margin', 'inventory', 'feature'),
  ('inventory.land-costing.export', 'Inventory: Export Land Costing Report', 'inventory', 'action'),

  ('purchase-order.tab.deliveries', 'PO Tab: Deliveries', 'purchase-order', 'tab'),
  ('purchase-order.tab.approvals', 'PO Tab: Approvals', 'purchase-order', 'tab'),
  ('purchase-order.tab.master-data', 'PO Tab: Master Data', 'purchase-order', 'tab'),
  ('purchase-order.button.send-for-approval', 'PO Action: Send for Approval', 'purchase-order', 'action'),
  ('purchase-order.button.revert-deliveries', 'PO Action: Revert to Deliveries', 'purchase-order', 'action')
ON CONFLICT (key) DO NOTHING;

-- 2) Create Business Owner role in tblrbac (idempotent), copying legacy menu/permission CSVs from existing admin/super role when possible.
DO $$
DECLARE
  role_name_col TEXT;
  role_menus_col TEXT;
  role_permission_col TEXT;
  source_role_id BIGINT;
  existing_business_owner_id BIGINT;
BEGIN
  SELECT c.column_name
  INTO role_name_col
  FROM information_schema.columns c
  WHERE c.table_schema = 'public' AND c.table_name = 'tblrbac' AND lower(c.column_name) = 'rolename'
  LIMIT 1;

  SELECT c.column_name
  INTO role_menus_col
  FROM information_schema.columns c
  WHERE c.table_schema = 'public' AND c.table_name = 'tblrbac' AND lower(c.column_name) = 'rolemenus'
  LIMIT 1;

  SELECT c.column_name
  INTO role_permission_col
  FROM information_schema.columns c
  WHERE c.table_schema = 'public' AND c.table_name = 'tblrbac' AND lower(c.column_name) = 'rolepermission'
  LIMIT 1;

  IF role_name_col IS NULL THEN
    RAISE EXCEPTION 'tblrbac role name column not found (expected roleName/rolename).';
  END IF;

  EXECUTE format(
    'SELECT id FROM public.tblrbac WHERE lower(coalesce(%I::text, '''')) = lower(''Business Owner'') LIMIT 1',
    role_name_col
  ) INTO existing_business_owner_id;

  IF existing_business_owner_id IS NOT NULL THEN
    RETURN;
  END IF;

  EXECUTE format(
    'SELECT id
       FROM public.tblrbac
      WHERE lower(coalesce(%I::text, '''')) LIKE ''%%admin%%''
         OR lower(coalesce(%I::text, '''')) LIKE ''%%super%%''
      ORDER BY id
      LIMIT 1',
    role_name_col,
    role_name_col
  ) INTO source_role_id;

  IF role_menus_col IS NOT NULL AND role_permission_col IS NOT NULL AND source_role_id IS NOT NULL THEN
    EXECUTE format(
      'INSERT INTO public.tblrbac (%I, %I, %I)
       SELECT ''Business Owner'', coalesce(src.%I::text, ''''), coalesce(src.%I::text, '''')
       FROM public.tblrbac src
       WHERE src.id = $1',
      role_name_col,
      role_menus_col,
      role_permission_col,
      role_menus_col,
      role_permission_col
    ) USING source_role_id;
  ELSIF role_menus_col IS NOT NULL AND role_permission_col IS NOT NULL THEN
    EXECUTE format(
      'INSERT INTO public.tblrbac (%I, %I, %I)
       VALUES (''Business Owner'', '''', '''')',
      role_name_col,
      role_menus_col,
      role_permission_col
    );
  ELSE
    EXECUTE format(
      'INSERT INTO public.tblrbac (%I)
       VALUES (''Business Owner'')',
      role_name_col
    );
  END IF;
END
$$;

-- 3) Business Owner acts as superadmin: assign ALL auth permission keys to the role.
WITH business_owner_role AS (
  SELECT id AS role_id
  FROM public.tblrbac r
  WHERE lower(coalesce(to_jsonb(r)->>'roleName', to_jsonb(r)->>'rolename', '')) = 'business owner'
  LIMIT 1
)
INSERT INTO public.auth_role_permissions(role_id, permission_id)
SELECT bo.role_id, pk.id
FROM business_owner_role bo
CROSS JOIN public.auth_permission_keys pk
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 4) Ensure existing admin/super roles receive NEW keys introduced by this migration.
WITH privileged_roles AS (
  SELECT r.id AS role_id
  FROM public.tblrbac r
  WHERE lower(coalesce(to_jsonb(r)->>'roleName', to_jsonb(r)->>'rolename', '')) LIKE '%admin%'
     OR lower(coalesce(to_jsonb(r)->>'roleName', to_jsonb(r)->>'rolename', '')) LIKE '%super%'
), new_keys AS (
  SELECT id
  FROM public.auth_permission_keys
  WHERE key IN (
    'accounting.view',
    'accounting.report.cheque-voucher.view',
    'accounting.report.general-journal-register.view',
    'accounting.report.disbursement-register.view',
    'accounting.report.sales-register.view',
    'accounting.report.tax-2307-report.view',
    'accounting.report.weekly-sales.view',
    'accounting.report.daily-unit-released.view',
    'accounting.report.low-stocks-report.view',
    'accounting.report.action.generate',
    'accounting.report.action.export',
    'accounting.report.action.print',
    'accounting.report.action.edit-draft',
    'inventory.land-costing.view',
    'inventory.land-costing.margin.view',
    'inventory.land-costing.export',
    'purchase-order.tab.deliveries',
    'purchase-order.tab.approvals',
    'purchase-order.tab.master-data',
    'purchase-order.button.send-for-approval',
    'purchase-order.button.revert-deliveries'
  )
)
INSERT INTO public.auth_role_permissions(role_id, permission_id)
SELECT pr.role_id, nk.id
FROM privileged_roles pr
CROSS JOIN new_keys nk
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;
