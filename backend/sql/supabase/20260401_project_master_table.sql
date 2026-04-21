-- Migration: Create project master table for project-based sales orders
-- Date: 2026-04-01
-- Purpose: Add normalized tblprojects table to store reusable project definitions
--          and link sales orders to specific projects to support staggered SO release

BEGIN;

-- Create project master table
CREATE TABLE IF NOT EXISTS public.tblprojects (
  id BIGSERIAL PRIMARY KEY,
  project_code VARCHAR(50) UNIQUE NOT NULL,
  project_name TEXT NOT NULL,
  project_type VARCHAR(50), -- e.g., 'commercial', 'residential', 'industrial'
  project_owner TEXT,
  project_owner_id BIGINT REFERENCES public.tblusers(id) ON DELETE SET NULL,
  project_location TEXT,
  project_start_date DATE,
  project_end_date DATE,
  project_manager TEXT,
  project_manager_id BIGINT REFERENCES public.tblusers(id) ON DELETE SET NULL,
  project_status VARCHAR(20) NOT NULL DEFAULT 'planning' CHECK (project_status IN ('planning', 'ongoing', 'completed', 'cancelled')),
  project_notes TEXT,
  branch_id BIGINT,
  
  -- Audit and tracking
  created_by BIGINT REFERENCES public.tblusers(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  CONSTRAINT tblprojects_project_code_key UNIQUE (project_code)
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_tblprojects_project_code ON public.tblprojects(project_code);
CREATE INDEX IF NOT EXISTS idx_tblprojects_project_name ON public.tblprojects(project_name);
CREATE INDEX IF NOT EXISTS idx_tblprojects_project_status ON public.tblprojects(project_status);
CREATE INDEX IF NOT EXISTS idx_tblprojects_branch_id ON public.tblprojects(branch_id);
CREATE INDEX IF NOT EXISTS idx_tblprojects_project_owner_id ON public.tblprojects(project_owner_id);

-- Add project_id column to tblsales_order if not exists
ALTER TABLE public.tblsales_order
  ADD COLUMN IF NOT EXISTS project_id BIGINT NULL REFERENCES public.tblprojects(id) ON DELETE SET NULL;

-- Create index for project_id lookup
CREATE INDEX IF NOT EXISTS idx_tblsales_order_project_id ON public.tblsales_order(project_id);

-- Set up timestamp trigger if not exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE proname = 'set_current_timestamp_updated_at'
      AND pg_function_is_visible(oid)
  ) THEN
    DROP TRIGGER IF EXISTS trg_tblprojects_updated_at ON public.tblprojects;
    CREATE TRIGGER trg_tblprojects_updated_at
    BEFORE UPDATE ON public.tblprojects
    FOR EACH ROW EXECUTE FUNCTION public.set_current_timestamp_updated_at();
  END IF;
END $$;

-- Add audit log table comment
COMMENT ON TABLE public.tblprojects IS 'Master table for project definitions; supports multiple sales orders per project for staggered unit releases';

COMMIT;
