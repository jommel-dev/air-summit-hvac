-- Migration: add quotation validity and expiry lifecycle fields

ALTER TABLE public.tblquotation
  ADD COLUMN IF NOT EXISTS validity_days integer NOT NULL DEFAULT 14,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS expired_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS is_deleted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz NULL;

ALTER TABLE public.tblquotation
  DROP CONSTRAINT IF EXISTS tblquotation_status_check;

ALTER TABLE public.tblquotation
  ADD CONSTRAINT tblquotation_status_check
  CHECK (LOWER(status) IN ('draft', 'finalized', 'converted', 'cancelled', 'expired'));

UPDATE public.tblquotation
SET
  validity_days = COALESCE(validity_days, 14),
  expires_at = COALESCE(
    expires_at,
    COALESCE(quote_date, created_at, NOW())
      + make_interval(days => GREATEST(COALESCE(validity_days, 14), 1))
  )
WHERE expires_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_tblquotation_is_deleted
  ON public.tblquotation(is_deleted);

CREATE INDEX IF NOT EXISTS idx_tblquotation_expires_at
  ON public.tblquotation(expires_at);

COMMENT ON COLUMN public.tblquotation.validity_days IS
  'Quotation validity in days used to auto-expire draft quotations.';

COMMENT ON COLUMN public.tblquotation.expires_at IS
  'Timestamp when the quotation becomes expired based on quote_date + validity_days.';

COMMENT ON COLUMN public.tblquotation.expired_at IS
  'Timestamp when the quotation was marked expired and moved to trash.';

COMMENT ON COLUMN public.tblquotation.is_deleted IS
  'Soft-delete flag used for expired quotations moved to trash.';

COMMENT ON COLUMN public.tblquotation.deleted_at IS
  'Timestamp when a quotation was soft-deleted into trash.';