-- Quotation feature migration
-- Date: 2026-03-08
--
-- Adds normalized quotation tables and permission keys.
-- Table names follow legacy convention and start with "tbl".

BEGIN;

CREATE TABLE IF NOT EXISTS public.tblquotation (
  id BIGSERIAL PRIMARY KEY,
  quote_no TEXT NOT NULL UNIQUE,
  quote_date DATE NOT NULL DEFAULT CURRENT_DATE,

  -- Normalized FK to customer; keep denormalized snapshot fields for immutable print preview.
  customer_id uuid REFERENCES public.tblcustomer(id) ON DELETE SET NULL,
  customer_name TEXT,
  customer_address TEXT,
  customer_contact_person TEXT,
  customer_contact_number TEXT,
  customer_email TEXT,
  customer_tin_number TEXT,

  total_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  remarks TEXT,

  -- Track downstream conversion to Sales Order.
  converted_sales_id BIGINT REFERENCES public.tblsales_order(id) ON DELETE SET NULL,

  -- Audit and multi-branch friendliness.
  created_by BIGINT REFERENCES public.tblusers(id) ON DELETE SET NULL,
  branch_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT tblquotation_status_check
    CHECK (LOWER(status) IN ('draft', 'finalized', 'converted', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_tblquotation_customer_id ON public.tblquotation(customer_id);
CREATE INDEX IF NOT EXISTS idx_tblquotation_status ON public.tblquotation(status);
CREATE INDEX IF NOT EXISTS idx_tblquotation_quote_date ON public.tblquotation(quote_date);
CREATE INDEX IF NOT EXISTS idx_tblquotation_created_at ON public.tblquotation(created_at DESC);

CREATE OR REPLACE FUNCTION public.tblquotation_set_quote_no()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id IS NULL THEN
    NEW.id := nextval(pg_get_serial_sequence('public.tblquotation', 'id'));
  END IF;

  IF NEW.quote_no IS NULL OR btrim(NEW.quote_no) = '' THEN
    NEW.quote_no :=
      'QT-' ||
      to_char(COALESCE(NEW.quote_date, CURRENT_DATE), 'YYYYMMDD') ||
      '-' ||
      lpad(NEW.id::text, 6, '0');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tblquotation_set_quote_no ON public.tblquotation;
CREATE TRIGGER trg_tblquotation_set_quote_no
BEFORE INSERT ON public.tblquotation
FOR EACH ROW EXECUTE FUNCTION public.tblquotation_set_quote_no();

CREATE TABLE IF NOT EXISTS public.tblquotation_items (
  id BIGSERIAL PRIMARY KEY,

  -- Normalized FK to quotation header.
  quotation_id BIGINT NOT NULL REFERENCES public.tblquotation(id) ON DELETE CASCADE,

  -- Normalized product-capacity references used by conversion to SO.
  product_id BIGINT REFERENCES public.tblproducts(id) ON DELETE SET NULL,
  capacity_id BIGINT REFERENCES public.tblcapacity(id) ON DELETE SET NULL,

  unit_price NUMERIC(14, 2) NOT NULL DEFAULT 0,
  sell_price NUMERIC(14, 2) NOT NULL DEFAULT 0,
  discount_price NUMERIC(14, 2) NOT NULL DEFAULT 0,

  -- Keep same shape as existing SO/PO item handling.
  unit_types_qty JSONB NOT NULL DEFAULT '[]'::jsonb,
  total_set_qty INTEGER NOT NULL DEFAULT 0,
  line_total NUMERIC(14, 2) NOT NULL DEFAULT 0,
  remarks TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tblquotation_items_quotation_id
  ON public.tblquotation_items(quotation_id);
CREATE INDEX IF NOT EXISTS idx_tblquotation_items_product_id
  ON public.tblquotation_items(product_id);
CREATE INDEX IF NOT EXISTS idx_tblquotation_items_capacity_id
  ON public.tblquotation_items(capacity_id);

-- Reuse existing timestamp trigger function from RBAC migration when available.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE proname = 'set_current_timestamp_updated_at'
      AND pg_function_is_visible(oid)
  ) THEN
    DROP TRIGGER IF EXISTS trg_tblquotation_updated_at ON public.tblquotation;
    CREATE TRIGGER trg_tblquotation_updated_at
    BEFORE UPDATE ON public.tblquotation
    FOR EACH ROW EXECUTE FUNCTION public.set_current_timestamp_updated_at();

    DROP TRIGGER IF EXISTS trg_tblquotation_items_updated_at ON public.tblquotation_items;
    CREATE TRIGGER trg_tblquotation_items_updated_at
    BEFORE UPDATE ON public.tblquotation_items
    FOR EACH ROW EXECUTE FUNCTION public.set_current_timestamp_updated_at();
  END IF;
END $$;

-- Seed normalized permission keys for quotation feature.
INSERT INTO public.auth_permission_keys(key, label, module, scope)
VALUES
  ('quotation.view', 'View Quotations', 'quotation', 'feature'),
  ('quotation.create', 'Create Quotation', 'quotation', 'action'),
  ('quotation.edit', 'Edit Quotation', 'quotation', 'action'),
  ('quotation.finalize', 'Finalize Quotation', 'quotation', 'action'),
  ('quotation.convert', 'Convert Quotation to SO', 'quotation', 'action'),
  ('quotation.print', 'Print Quotation', 'quotation', 'action'),
  ('legacy.menu.quotation', 'Legacy Menu: quotation', 'legacy', 'menu')
ON CONFLICT (key) DO NOTHING;

-- Bridge legacy roleMenus token (quotation) into normalized role-permission mapping.
INSERT INTO public.auth_role_permissions(role_id, permission_id)
SELECT DISTINCT
  r.id AS role_id,
  pk.id AS permission_id
FROM public.tblrbac r
INNER JOIN public.auth_permission_keys pk
  ON pk.key = 'legacy.menu.quotation'
WHERE EXISTS (
  SELECT 1
  FROM regexp_split_to_table(
    COALESCE(to_jsonb(r)->>'roleMenus', to_jsonb(r)->>'rolemenus', ''),
    ','
  ) AS token
  WHERE lower(trim(token)) = 'quotation'
)
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;
