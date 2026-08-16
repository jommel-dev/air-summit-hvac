-- Soft delete for products and capacity.
-- Products already have deleted_at / deleted_by; this adds the same to capacity
-- and lets a deleted product name be reused.

ALTER TABLE public.tblcapacity
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL;

ALTER TABLE public.tblcapacity
  ADD COLUMN IF NOT EXISTS deleted_by BIGINT NULL;

CREATE INDEX IF NOT EXISTS idx_tblcapacity_deleted_at
  ON public.tblcapacity(deleted_at)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_tblproducts_deleted_at
  ON public.tblproducts(deleted_at)
  WHERE deleted_at IS NULL;

ALTER TABLE public.tblproducts
  DROP CONSTRAINT IF EXISTS tblproducts_productName_key;

DROP INDEX IF EXISTS tblproducts_productName_key;

CREATE UNIQUE INDEX IF NOT EXISTS tblproducts_productname_active_uidx
  ON public.tblproducts ("productName")
  WHERE deleted_at IS NULL;
