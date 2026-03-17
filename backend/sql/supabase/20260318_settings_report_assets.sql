ALTER TABLE public.tblsettings
  ADD COLUMN IF NOT EXISTS "businessLogoLight" TEXT,
  ADD COLUMN IF NOT EXISTS "businessLogoDark" TEXT,
  ADD COLUMN IF NOT EXISTS "drTemplatePdf" TEXT;
