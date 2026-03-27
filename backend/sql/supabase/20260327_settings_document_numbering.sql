-- Document numbering prefix/suffix for each document type
-- Date: 2026-03-27

BEGIN;

ALTER TABLE public.tblsettings
  ADD COLUMN IF NOT EXISTS cv_number_prefix TEXT DEFAULT 'CV',
  ADD COLUMN IF NOT EXISTS cv_number_suffix TEXT DEFAULT '';

COMMIT;
