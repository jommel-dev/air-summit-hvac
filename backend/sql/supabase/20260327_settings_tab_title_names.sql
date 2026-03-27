ALTER TABLE public.tblsettings
  ADD COLUMN IF NOT EXISTS website_tab_name text,
  ADD COLUMN IF NOT EXISTS routing_tab_name text;