-- Add project-related fields to sales orders so we can capture additional metadata when salesType = 'project'.

ALTER TABLE public.tblsales_order
  ADD COLUMN IF NOT EXISTS project_name text NULL,
  ADD COLUMN IF NOT EXISTS project_code text NULL;
