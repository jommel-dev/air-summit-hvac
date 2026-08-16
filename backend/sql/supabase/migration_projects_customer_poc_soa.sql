-- Migration: Projects-first flow
-- - customer_id + POC on tblprojects
-- - project_id on tblstatement_of_account for project-scoped SOA

ALTER TABLE public.tblprojects
  ADD COLUMN IF NOT EXISTS customer_id UUID NULL REFERENCES public.tblcustomer(id)
    ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE public.tblprojects
  ADD COLUMN IF NOT EXISTS poc_name TEXT NULL;

ALTER TABLE public.tblprojects
  ADD COLUMN IF NOT EXISTS poc_phone VARCHAR(50) NULL;

ALTER TABLE public.tblprojects
  ADD COLUMN IF NOT EXISTS poc_email VARCHAR(255) NULL;

CREATE INDEX IF NOT EXISTS idx_tblprojects_customer_id
  ON public.tblprojects(customer_id);

ALTER TABLE public.tblstatement_of_account
  ADD COLUMN IF NOT EXISTS project_id BIGINT NULL REFERENCES public.tblprojects(id)
    ON UPDATE CASCADE ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_soa_project_id
  ON public.tblstatement_of_account(project_id)
  WHERE project_id IS NOT NULL;
