-- Accounting report print settings (branch-aware, reusable per report)
-- Date: 2026-03-27

BEGIN;

CREATE TABLE IF NOT EXISTS public.tblaccounting_report_print_settings (
  id BIGSERIAL PRIMARY KEY,
  report_key TEXT NOT NULL,
  branch_id BIGINT NOT NULL DEFAULT 0,
  settings_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by BIGINT NULL,
  updated_by BIGINT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tblaccounting_report_print_settings_report_branch
  ON public.tblaccounting_report_print_settings (report_key, branch_id);

CREATE INDEX IF NOT EXISTS idx_tblaccounting_report_print_settings_report_key
  ON public.tblaccounting_report_print_settings (report_key);

CREATE INDEX IF NOT EXISTS idx_tblaccounting_report_print_settings_branch_id
  ON public.tblaccounting_report_print_settings (branch_id);

COMMIT;
