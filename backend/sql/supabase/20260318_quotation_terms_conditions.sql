-- Migration: Add terms_conditions JSONB column to tblquotation
-- Date: 2026-03-18
-- Purpose: Store editable T&C fields per quotation (Warranty Exception, Validity, Note, Penalty Fee, Warranty)

ALTER TABLE public.tblquotation
  ADD COLUMN IF NOT EXISTS terms_conditions JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.tblquotation.terms_conditions IS
  'Stores editable Terms & Conditions fields per quotation: warrantyException, validity, note, penaltyFee, warranty';
