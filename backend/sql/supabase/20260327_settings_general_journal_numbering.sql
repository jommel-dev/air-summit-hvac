-- General Journal numbering prefix/suffix settings
-- Date: 2026-03-27

BEGIN;

ALTER TABLE public.tblsettings
  ADD COLUMN IF NOT EXISTS gj_number_prefix TEXT DEFAULT 'GJ',
  ADD COLUMN IF NOT EXISTS gj_number_suffix TEXT DEFAULT '';

COMMIT;